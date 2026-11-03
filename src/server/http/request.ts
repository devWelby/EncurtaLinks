import { Errors } from './errors.ts';

export function assertMethod(req: Request, allowed: string[]): void {
  if (!allowed.includes(req.method)) throw Errors.methodNotAllowed(allowed);
}

function mediaType(req: Request): string {
  return (req.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

/** Lê o corpo com limite de bytes, mesmo sem Content-Length (transferência em partes). */
export async function readBodyText(req: Request, maxBytes: number): Promise<string> {
  const declared = req.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) throw Errors.payloadTooLarge();
  if (req.body === null) return '';
  const reader = (req.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw Errors.payloadTooLarge();
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(merged);
  } catch {
    throw Errors.badRequest('O corpo da requisição não é UTF-8 válido.');
  }
}

export async function readJson(req: Request, maxBytes: number): Promise<unknown> {
  if (mediaType(req) !== 'application/json') throw Errors.unsupportedMediaType('application/json');
  const text = await readBodyText(req, maxBytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw Errors.badRequest('JSON inválido.');
  }
}

export async function readForm(req: Request, maxBytes: number): Promise<URLSearchParams> {
  if (mediaType(req) !== 'application/x-www-form-urlencoded') throw Errors.unsupportedMediaType('application/x-www-form-urlencoded');
  return new URLSearchParams(await readBodyText(req, maxBytes));
}

/**
 * Exige que a requisição venha da mesma origem quando o navegador informa
 * a origem (Origin / Sec-Fetch-Site). Não substitui autenticação.
 */
export function assertSameOrigin(req: Request, expectedOrigin: string, options: { requireOriginHeader: boolean }): void {
  const origin = req.headers.get('origin');
  if (origin !== null) {
    if (origin !== expectedOrigin) throw Errors.forbidden('Origem da requisição não permitida.', 'bad_origin');
  } else if (options.requireOriginHeader) {
    throw Errors.forbidden('Origem da requisição ausente.', 'bad_origin');
  }
  const site = req.headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin' && site !== 'none') {
    throw Errors.forbidden('Requisição entre sites não permitida.', 'bad_origin');
  }
}

export function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (header === null) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!cookies.has(name)) {
      try {
        cookies.set(name, decodeURIComponent(value));
      } catch {
        // Ignora cookies malformados.
      }
    }
  }
  return cookies;
}

export interface CookieOptions {
  maxAgeSeconds?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  path?: string;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name.replace(/^__Host-/, ''))) throw new Error('Nome de cookie inválido');
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? '/'}`];
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
  if (options.httpOnly ?? true) parts.push('HttpOnly');
  if (options.secure ?? true) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite ?? 'Strict'}`);
  return parts.join('; ');
}
