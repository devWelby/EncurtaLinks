import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inject } from 'vitest';
import { loadAdminConfig, loadPublicConfig, type AdminConfig, type PublicConfig } from '../../src/server/config.ts';
import { createDatabase } from '../../src/server/db/pool.ts';
import type { Database } from '../../src/server/db/types.ts';
import type { AdminDeps, PublicDeps, RequestContext } from '../../src/server/handlers/context.ts';
import { TEST_ANTIBOT_TOKEN } from '../../src/shared/constants.ts';

export const PUBLIC_ORIGIN = 'http://localhost:8888';
export const ADMIN_ORIGIN = 'http://127.0.0.1:8889';
export const VALID_ANTIBOT = TEST_ANTIBOT_TOKEN;

let sharedDb: Database | null = null;

/** Banco de teste compartilhado no arquivo (fechado em afterAll pelo chamador). */
export function testDb(): Database {
  sharedDb ??= createDatabase({ connectionString: inject('databaseUrl'), ssl: 'disable', maxConnections: 8 });
  return sharedDb;
}

export async function closeTestDb(): Promise<void> {
  if (sharedDb !== null) {
    await sharedDb.end();
    sharedDb = null;
  }
}

const SEED = readFileSync(resolve(import.meta.dirname, '..', '..', 'db', 'migrations', '0002_default_data.sql'), 'utf8');

/** Esvazia todas as tabelas da aplicação e recarrega os dados padrão. */
export async function resetDb(db: Database): Promise<void> {
  await db.query(`TRUNCATE app.links, app.continuation_tickets, app.reports, app.blocked_domains, app.admin_sessions,
    app.admin_audit_log, app.app_settings, app.legal_documents, app.daily_metrics, app.link_daily_metrics,
    app.rate_limit_counters RESTART IDENTITY CASCADE`);
  await db.query(SEED);
}

export function baseEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    APP_ENV: 'test',
    DATABASE_URL: inject('databaseUrl'),
    DATABASE_SSL: 'disable',
    IP_HASH_SECRET: 'test-ip-hash-secret-with-at-least-32-chars',
    ANTIBOT_MODE: 'test',
    PUBLIC_SITE_URL: PUBLIC_ORIGIN,
    ADMIN_SITE_URL: ADMIN_ORIGIN,
    ...overrides,
  };
}

export function publicConfig(overrides: Record<string, string> = {}): PublicConfig {
  const result = loadPublicConfig(baseEnv(overrides), 'dev');
  if (!result.ok) throw new Error(`Configuração pública inválida: ${result.errors.join('; ')}`);
  return result.config;
}

export function adminConfig(overrides: Record<string, string> = {}): AdminConfig {
  const result = loadAdminConfig(
    baseEnv({ GITHUB_CLIENT_ID: 'test-client-id', GITHUB_CLIENT_SECRET: 'test-client-secret', ADMIN_GITHUB_USER_IDS: '1001', ...overrides }),
    'dev',
  );
  if (!result.ok) throw new Error(`Configuração admin inválida: ${result.errors.join('; ')}`);
  return result.config;
}

export function publicDeps(db: Database, overrides: Partial<PublicDeps> = {}, env: Record<string, string> = {}): PublicDeps {
  return { config: publicConfig(env), db, ...overrides };
}

export function adminDeps(db: Database, overrides: Partial<AdminDeps> = {}, env: Record<string, string> = {}): AdminDeps {
  return { config: adminConfig(env), db, ...overrides };
}

/** Contexto de requisição; as promessas de waitUntil são guardadas para o teste aguardar. */
export function requestContext(ip: string | null = '203.0.113.10'): RequestContext & { settle: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  return {
    clientIp: ip,
    requestId: 'test-request',
    waitUntil: (promise) => {
      pending.push(promise.catch(() => undefined));
    },
    settle: async () => {
      await Promise.all(pending.splice(0));
    },
  };
}

export function jsonRequest(url: string, body: unknown, init: { method?: string; headers?: Record<string, string> } = {}): Request {
  return new Request(url, {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    body: JSON.stringify(body),
  });
}

export function formRequest(url: string, fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

/** Banco que falha em todas as consultas (simula indisponibilidade). */
export function failingDb(): Database {
  const fail = (): Promise<never> => Promise.reject(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }));
  return { query: fail, transaction: fail, end: () => Promise.resolve() };
}

/** Extrai o ticket do formulário da página intermediária. */
export function extractTicket(html: string): string {
  const match = /name="ticket" value="([A-Za-z0-9_-]{43})"/.exec(html);
  if (!match?.[1]) throw new Error('Ticket não encontrado na página');
  return match[1];
}
