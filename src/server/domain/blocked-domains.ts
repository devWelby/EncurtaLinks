import type { Queryable } from '../db/types.ts';
import { hostSuffixes } from '../security/url-policy.ts';

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Normaliza entrada de domínio do administrador (aceita URL ou domínio; IDN vira punycode). */
export function normalizeDomainInput(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === '' || trimmed.length > 300) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    const host = url.hostname.replace(/\.$/, '');
    if (host.length > 253 || !DOMAIN_PATTERN.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

/** Retorna o domínio bloqueado que cobre o host (ele mesmo ou um domínio pai), se houver. */
export async function findBlockingDomain(db: Queryable, host: string): Promise<string | null> {
  const { rows } = await db.query<{ domain: string }>(
    'SELECT domain FROM app.blocked_domains WHERE domain = ANY($1::text[]) ORDER BY char_length(domain) DESC LIMIT 1',
    [hostSuffixes(host)],
  );
  return rows[0]?.domain ?? null;
}

export interface BlockedDomainRow {
  domain: string;
  reason: string | null;
  created_at: Date;
  created_by: string | null;
}

export async function listBlockedDomains(db: Queryable, options: { q: string; limit: number; offset: number }): Promise<BlockedDomainRow[]> {
  const pattern = `%${escapeLike(options.q.toLowerCase())}%`;
  const { rows } = await db.query<BlockedDomainRow>(
    `SELECT domain, reason, created_at, created_by FROM app.blocked_domains
     WHERE $1 = '%%' OR domain LIKE $1 ESCAPE '\\'
     ORDER BY created_at DESC, domain LIMIT $2 OFFSET $3`,
    [pattern, options.limit, options.offset],
  );
  return rows;
}

export async function addBlockedDomain(db: Queryable, domain: string, reason: string | null, createdBy: string): Promise<boolean> {
  const { rowCount } = await db.query(
    'INSERT INTO app.blocked_domains (domain, reason, created_by) VALUES ($1, $2, $3) ON CONFLICT (domain) DO NOTHING',
    [domain, reason, createdBy],
  );
  return (rowCount ?? 0) > 0;
}

export async function removeBlockedDomain(db: Queryable, domain: string): Promise<boolean> {
  const { rowCount } = await db.query('DELETE FROM app.blocked_domains WHERE domain = $1', [domain]);
  return (rowCount ?? 0) > 0;
}

/** Escapa curingas de LIKE (% _ \) em texto de busca. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
