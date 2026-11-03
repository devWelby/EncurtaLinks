import { loadAdminConfig, loadPublicConfig } from './config.ts';
import { createDatabase } from './db/pool.ts';
import type { Database } from './db/types.ts';
import type { AdminDeps, PublicDeps, RequestContext } from './handlers/context.ts';
import { HttpError } from './http/errors.ts';
import { errorJson, htmlResponse } from './http/response.ts';
import { logger } from './logger.ts';
import { randomToken } from './security/crypto.ts';
import { statusPage, statusPageCsp } from './render/pages.ts';

/**
 * Integração com o runtime do Netlify (ou com o emulador local).
 * Somente o subconjunto do `Context` do Netlify usado pela aplicação.
 */
export interface PlatformContext {
  ip?: string;
  requestId?: string;
  deploy?: { context?: string };
  waitUntil?: (promise: Promise<unknown>) => void;
}

export function toRequestContext(context: PlatformContext): RequestContext {
  return {
    clientIp: typeof context.ip === 'string' && context.ip !== '' ? context.ip : null,
    requestId: context.requestId ?? randomToken(8),
    waitUntil: (promise) => {
      const safe = promise.catch(() => undefined);
      if (typeof context.waitUntil === 'function') context.waitUntil(safe);
    },
  };
}

function deployContextOf(context: PlatformContext): string {
  return context.deploy?.context ?? 'dev';
}

const databases = new Map<string, Database>();

function databaseFor(options: Parameters<typeof createDatabase>[0]): Database {
  const key = `${options.connectionString}|${options.ssl}`;
  let db = databases.get(key);
  if (db === undefined) {
    db = createDatabase(options);
    databases.set(key, db);
  }
  return db;
}

export type RuntimeResult<T> = { ok: true; deps: T } | { ok: false; response: (format: 'json' | 'html') => Response };

const misconfigured = (format: 'json' | 'html'): Response => {
  if (format === 'json') {
    return errorJson(new HttpError(503, 'not_configured', 'Serviço em configuração. Tente novamente mais tarde.'));
  }
  const nonce = randomToken(16);
  const page = statusPage('unavailable', nonce);
  return htmlResponse(503, page.html, { csp: statusPageCsp(nonce) });
};

let publicCache: { key: string; result: RuntimeResult<PublicDeps> } | null = null;
let adminCache: { key: string; result: RuntimeResult<AdminDeps> } | null = null;

export function getPublicRuntime(context: PlatformContext, env: Record<string, string | undefined> = process.env): RuntimeResult<PublicDeps> {
  const deployContext = deployContextOf(context);
  if (publicCache?.key === deployContext) return publicCache.result;
  const loaded = loadPublicConfig(env, deployContext);
  let result: RuntimeResult<PublicDeps>;
  if (!loaded.ok) {
    // Registra apenas os nomes/regras das variáveis com problema, nunca valores.
    logger.error('config_invalid', { kind: 'public', reason: loaded.errors.join(' | ') });
    result = { ok: false, response: misconfigured };
  } else {
    for (const warning of loaded.warnings) logger.warn('config_warning', { kind: 'public', reason: warning });
    result = { ok: true, deps: { config: loaded.config, db: databaseFor(loaded.config.database) } };
  }
  publicCache = { key: deployContext, result };
  return result;
}

export function getAdminRuntime(context: PlatformContext, env: Record<string, string | undefined> = process.env): RuntimeResult<AdminDeps> {
  const deployContext = deployContextOf(context);
  if (adminCache?.key === deployContext) return adminCache.result;
  const loaded = loadAdminConfig(env, deployContext);
  let result: RuntimeResult<AdminDeps>;
  if (!loaded.ok) {
    logger.error('config_invalid', { kind: 'admin', reason: loaded.errors.join(' | ') });
    result = { ok: false, response: misconfigured };
  } else {
    for (const warning of loaded.warnings) logger.warn('config_warning', { kind: 'admin', reason: warning });
    result = { ok: true, deps: { config: loaded.config, db: databaseFor({ ...loaded.config.database, maxConnections: 2 }) } };
  }
  adminCache = { key: deployContext, result };
  return result;
}

/** Usado pelos testes/emulador para recarregar a configuração. */
export function resetRuntimeCaches(): void {
  publicCache = null;
  adminCache = null;
}
