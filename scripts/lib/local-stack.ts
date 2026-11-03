/**
 * Sobe o ambiente local completo: PostgreSQL real (embarcado ou externo
 * local), migrações, build do frontend e os dois sites emulados.
 *
 *   Site público: http://localhost:<publicPort>
 *   Painel:       http://127.0.0.1:<adminPort>   (host diferente: cookies isolados)
 *
 * Rotas exclusivas do ambiente local (NUNCA existem nas funções publicadas):
 *   - painel  GET  /__dev/admin-login  → cria sessão administrativa local
 *   - público GET  /__mock-ads/*.js     → anúncios simulados (sem rede externa)
 *   - público POST /__e2e/redeploy      → simula novo deploy (somente E2E)
 */
import { resolve } from 'node:path';
import { build } from 'vite';
import { createDatabase } from '../../src/server/db/pool.ts';
import { runMigrations } from '../../src/server/db/migrate.ts';
import { createSession } from '../../src/server/domain/sessions.ts';
import { buildSessionCookie } from '../../src/server/handlers/admin-auth.ts';
import { shutdownRuntime } from '../../src/server/runtime.ts';
import { startLocalPostgres } from './local-postgres.ts';
import { EmulatedSite } from './netlify-emulator.ts';

export interface LocalStackOptions {
  mode: 'development' | 'test';
  publicPort: number;
  adminPort: number;
  dbPort: number;
  dataDir: string;
  persistentDb: boolean;
  /** Apaga e recria o schema "app" (somente bancos locais descartáveis). */
  freshSchema: boolean;
  /** Variáveis adicionais (ex.: anúncios simulados no E2E). */
  env?: Record<string, string>;
  watchFrontend: boolean;
  log: boolean;
}

export interface LocalStack {
  publicSite: EmulatedSite;
  adminSite: EmulatedSite;
  stop: () => Promise<void>;
}

const repoRoot = resolve(import.meta.dirname, '..', '..');

const MOCK_BANNER = `(function(){
  var s=document.currentScript;if(!s||!s.parentNode)return;
  var d=document.createElement('div');d.setAttribute('data-mock-ad','banner');
  d.textContent='Anúncio simulado (ambiente local — nenhum anúncio real)';
  s.parentNode.insertBefore(d,s);
})();`;

export async function startLocalStack(options: LocalStackOptions): Promise<LocalStack> {
  if (process.env.NETLIFY === 'true') throw new Error('O ambiente local não deve rodar dentro do Netlify.');

  const db = await startLocalPostgres({
    dataDir: options.dataDir,
    port: options.dbPort,
    database: options.mode === 'test' ? 'encurtalinks_e2e' : 'encurtalinks_dev',
    urlEnv: options.mode === 'test' ? 'E2E_DATABASE_URL' : 'DEV_DATABASE_URL',
    persistent: options.persistentDb,
  });
  const host = new URL(db.connectionString).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error('O ambiente local só aceita PostgreSQL em localhost.');
  }

  const publicOrigin = `http://localhost:${options.publicPort}`;
  const adminOrigin = `http://127.0.0.1:${options.adminPort}`;
  Object.assign(process.env, {
    APP_ENV: options.mode,
    DATABASE_URL: db.connectionString,
    DATABASE_SSL: 'disable',
    IP_HASH_SECRET: 'local-only-ip-hash-secret-not-for-production-0001',
    ANTIBOT_MODE: process.env.ANTIBOT_MODE ?? 'test',
    PUBLIC_SITE_URL: publicOrigin,
    ADMIN_SITE_URL: adminOrigin,
    ...(options.env ?? {}),
  });

  const migrationDb = createDatabase({ connectionString: db.connectionString, ssl: 'disable', maxConnections: 1 });
  try {
    if (options.freshSchema) await migrationDb.query('DROP SCHEMA IF EXISTS app CASCADE');
    const report = await runMigrations(migrationDb, resolve(repoRoot, 'db', 'migrations'));
    if (options.log && report.applied.length > 0) console.log(`[db] migrações aplicadas: ${report.applied.join(', ')}`);
  } finally {
    await migrationDb.end();
  }

  // Frontend com o antiautomação simulado (o servidor só aceita esse modo localmente).
  process.env.VITE_ANTIBOT_MODE ??= process.env.ANTIBOT_MODE === 'test' ? 'test' : 'turnstile';
  // Saída separada de dist/ (que fica reservado aos builds reais de deploy).
  const outDir = (site: string): string => resolve(repoRoot, '.local-dist', options.mode, site);
  for (const site of ['public', 'admin']) {
    await build({
      configFile: resolve(repoRoot, 'apps', site, 'vite.config.ts'),
      logLevel: options.log ? 'info' : 'warn',
      build: { outDir: outDir(site), emptyOutDir: true, ...(options.watchFrontend ? { watch: {} } : {}) },
    });
  }

  const sessionDb = createDatabase({ connectionString: db.connectionString, ssl: 'disable', maxConnections: 2 });
  const publicSite: EmulatedSite = new EmulatedSite({
    name: 'público',
    repoRoot,
    tomlPath: 'apps/public/netlify.toml',
    publishDir: outDir('public'),
    hostname: 'localhost',
    port: options.publicPort,
    log: options.log,
    devRoutes: async (req) => {
      const { pathname } = new URL(req.url);
      if (pathname === '/__mock-ads/banner.js') {
        return new Response(MOCK_BANNER, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' } });
      }
      if (pathname === '/__mock-ads/fail.js') return new Response('indisponível', { status: 503 });
      if (pathname === '/__e2e/redeploy' && req.method === 'POST' && options.mode === 'test') {
        await shutdownRuntime();
        await publicSite.loadFunctions();
        await adminSite.loadFunctions();
        return new Response(null, { status: 204 });
      }
      return null;
    },
  });

  const adminSite: EmulatedSite = new EmulatedSite({
    name: 'painel',
    repoRoot,
    tomlPath: 'apps/admin/netlify.toml',
    publishDir: outDir('admin'),
    hostname: '127.0.0.1',
    port: options.adminPort,
    log: options.log,
    devRoutes: async (req) => {
      const { pathname } = new URL(req.url);
      if (pathname !== '/__dev/admin-login') return null;
      if (process.env.GITHUB_CLIENT_ID) return new Response('Login local desativado: GitHub OAuth configurado.', { status: 404 });
      const ttl = 8 * 3600;
      const { token } = await createSession(sessionDb, { githubId: 1, login: 'admin-local' }, ttl);
      return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': buildSessionCookie(token, ttl) } });
    },
  });

  await publicSite.start();
  await adminSite.start();

  return {
    publicSite,
    adminSite,
    stop: async () => {
      await publicSite.stop();
      await adminSite.stop();
      await shutdownRuntime();
      await sessionDb.end();
      await db.stop();
    },
  };
}
