/**
 * Emulador LOCAL mínimo do Netlify (desenvolvimento e testes E2E).
 *
 * Reproduz o que o EncurtaLinks usa da plataforma:
 *  - funções com `config.path` (URLPattern), com prioridade sobre arquivos e regras;
 *  - arquivos estáticos do diretório publicado;
 *  - regras [[redirects]] (reescrita 200, 404 e redirecionamentos) do netlify.toml;
 *  - regras [[headers]] aplicadas SOMENTE a arquivos estáticos (como no Netlify);
 *  - `context.ip`, `context.requestId`, `context.deploy.context = "dev"` e `waitUntil`.
 *
 * Não reproduz: rate limiting da plataforma, CDN/cache, funções agendadas,
 * bundling das funções. Esses pontos são verificados no primeiro deploy
 * (roteiro em docs/deploy.md). Nunca é publicado: vive apenas em scripts/.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'smol-toml';

type Handler = (req: Request, context: EmulatedContext) => Promise<Response> | Response;

export interface EmulatedContext {
  ip: string;
  requestId: string;
  deploy: { context: string; id: string; published: boolean };
  waitUntil: (promise: Promise<unknown>) => void;
}

interface FunctionRoute {
  name: string;
  patterns: URLPattern[];
  methods: string[] | null;
  handler: Handler;
}

interface RedirectRule {
  from: RegExp;
  to: string;
  status: number;
}

interface HeaderRule {
  for: RegExp;
  values: Record<string, string>;
}

export interface SiteOptions {
  name: string;
  repoRoot: string;
  /** Caminho do netlify.toml do site, relativo à raiz do repositório. */
  tomlPath: string;
  hostname: string;
  port: number;
  /** Diretório publicado (padrão: build.publish do netlify.toml). */
  publishDir?: string;
  /** Rotas exclusivas do ambiente local (ex.: login de desenvolvimento). Retorne null para seguir. */
  devRoutes?: (req: Request) => Promise<Response | null> | Response | null;
  log?: boolean;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

/** Converte padrões do Netlify ("/api/*", "/:id") em expressão regular. */
function netlifyPattern(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z_]\w*/g, '[^/]+'))
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

interface TomlShape {
  build?: { publish?: string };
  functions?: { directory?: string };
  redirects?: Array<{ from: string; to: string; status?: number }>;
  headers?: Array<{ for: string; values: Record<string, string> }>;
}

export class EmulatedSite {
  readonly options: SiteOptions;
  private readonly publishDir: string;
  private readonly functionsDir: string;
  private readonly redirects: RedirectRule[];
  private readonly headers: HeaderRule[];
  private functions: FunctionRoute[] = [];
  private generation = 0;
  private server: Server | null = null;
  private readonly pending = new Set<Promise<unknown>>();

  constructor(options: SiteOptions) {
    this.options = options;
    const toml = parse(readFileSync(resolve(options.repoRoot, options.tomlPath), 'utf8')) as TomlShape;
    this.publishDir = options.publishDir ?? resolve(options.repoRoot, toml.build?.publish ?? 'dist');
    this.functionsDir = resolve(options.repoRoot, toml.functions?.directory ?? 'netlify/functions');
    this.redirects = (toml.redirects ?? []).map((rule) => ({ from: netlifyPattern(rule.from), to: rule.to, status: rule.status ?? 301 }));
    this.headers = (toml.headers ?? []).map((rule) => ({ for: netlifyPattern(rule.for), values: rule.values }));
  }

  get origin(): string {
    return `http://${this.options.hostname}:${this.options.port}`;
  }

  /** (Re)carrega os módulos das funções — chamar de novo simula um novo deploy do código. */
  async loadFunctions(): Promise<void> {
    this.generation += 1;
    const routes: FunctionRoute[] = [];
    for (const file of readdirSync(this.functionsDir).filter((f) => /\.(mts|ts|mjs|js)$/.test(f)).sort()) {
      const url = `${pathToFileURL(join(this.functionsDir, file)).href}?deploy=${this.generation}`;
      const mod = (await import(url)) as { default?: Handler; config?: { path?: string | string[]; method?: string | string[]; schedule?: string } };
      if (typeof mod.default !== 'function') throw new Error(`Função sem export default: ${file}`);
      const config = mod.config ?? {};
      if (config.schedule !== undefined && config.path === undefined) continue; // agendada: sem rota HTTP
      const paths = config.path === undefined ? [`/.netlify/functions/${file.replace(/\.\w+$/, '')}`] : Array.isArray(config.path) ? config.path : [config.path];
      routes.push({
        name: file,
        patterns: paths.map((pathname) => new URLPattern({ pathname })),
        methods: config.method === undefined ? null : (Array.isArray(config.method) ? config.method : [config.method]).map((m) => m.toUpperCase()),
        handler: mod.default,
      });
    }
    this.functions = routes;
  }

  async start(): Promise<void> {
    await this.loadFunctions();
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolvePromise, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.options.port, this.options.hostname, () => resolvePromise());
    });
  }

  async stop(): Promise<void> {
    await Promise.allSettled([...this.pending]);
    await new Promise<void>((resolvePromise) => {
      if (this.server === null) return resolvePromise();
      this.server.closeAllConnections();
      this.server.close(() => resolvePromise());
    });
  }

  private async toRequest(req: IncomingMessage): Promise<Request> {
    const host = req.headers.host ?? `${this.options.hostname}:${this.options.port}`;
    const url = `http://${host}${req.url ?? '/'}`;
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) for (const v of value) headers.append(name, v);
      else headers.set(name, value);
    }
    const method = req.method ?? 'GET';
    let body: Buffer | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      body = Buffer.concat(chunks);
    }
    return new Request(url, { method, headers, ...(body !== undefined ? { body } : {}) });
  }

  private context(req: IncomingMessage): EmulatedContext {
    const raw = req.socket.remoteAddress ?? '127.0.0.1';
    return {
      ip: raw.startsWith('::ffff:') ? raw.slice(7) : raw,
      requestId: randomUUID(),
      deploy: { context: 'dev', id: `local-${this.generation}`, published: false },
      waitUntil: (promise) => {
        const tracked = promise.catch(() => undefined).finally(() => this.pending.delete(tracked));
        this.pending.add(tracked);
      },
    };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = Date.now();
    let response: Response;
    try {
      const request = await this.toRequest(req);
      response = await this.route(request, req);
    } catch (error) {
      console.error(`[${this.options.name}] erro no emulador:`, error instanceof Error ? error.message : error);
      response = new Response('Erro interno do emulador', { status: 500 });
    }
    const headers: Record<string, string | string[]> = {};
    response.headers.forEach((value, name) => {
      if (name !== 'set-cookie') headers[name] = value;
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) headers['set-cookie'] = cookies;
    const body = req.method === 'HEAD' ? null : Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, headers);
    res.end(body);
    if (this.options.log) {
      const path = (req.url ?? '/').split('?')[0];
      console.log(`[${this.options.name}] ${req.method} ${path} → ${response.status} (${Date.now() - started} ms)`);
    }
  }

  private async route(request: Request, raw: IncomingMessage): Promise<Response> {
    const url = new URL(request.url);

    if (this.options.devRoutes) {
      const dev = await this.options.devRoutes(request);
      if (dev !== null) return dev;
    }

    for (const fn of this.functions) {
      if (fn.methods !== null && !fn.methods.includes(request.method)) continue;
      if (fn.patterns.some((pattern) => pattern.test({ pathname: url.pathname }))) {
        return await fn.handler(request, this.context(raw));
      }
    }

    const file = this.staticFile(url.pathname);
    if (file !== null) return this.serveFile(file, 200, url.pathname);

    for (const rule of this.redirects) {
      if (!rule.from.test(url.pathname)) continue;
      if (rule.status === 200 || rule.status === 404) {
        const target = this.staticFile(rule.to);
        if (target !== null) return this.serveFile(target, rule.status, url.pathname);
        continue;
      }
      return new Response(null, { status: rule.status, headers: { Location: rule.to } });
    }
    return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  private staticFile(pathname: string): string | null {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    const candidate = resolve(this.publishDir, `.${decoded.endsWith('/') ? `${decoded}index.html` : decoded}`);
    if (candidate !== this.publishDir && !candidate.startsWith(this.publishDir + sep)) return null;
    if (!existsSync(candidate)) return null;
    const info = statSync(candidate);
    if (info.isDirectory()) {
      const index = join(candidate, 'index.html');
      return existsSync(index) ? index : null;
    }
    return candidate;
  }

  private serveFile(file: string, status: number, requestPath: string): Response {
    const headers = new Headers({ 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    for (const rule of this.headers) {
      if (!rule.for.test(requestPath)) continue;
      for (const [name, value] of Object.entries(rule.values)) headers.set(name, value);
    }
    return new Response(readFileSync(file), { status, headers });
  }
}
