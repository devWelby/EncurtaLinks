import type { Queryable } from '../db/types.ts';
import { isPgError, UNIQUE_VIOLATION } from '../db/pool.ts';
import { generateSlug } from '../security/crypto.ts';
import { escapeLike } from './blocked-domains.ts';

export type LinkStatus = 'active' | 'blocked' | 'deleted';

export interface NewLinkInput {
  destinationUrl: string;
  destinationHost: string;
  expiresInSeconds: number | null;
  creatorIpHash: Buffer | null;
}

export interface CreatedLink {
  slug: string;
  expiresAt: Date | null;
}

export class SlugCollisionError extends Error {
  constructor() {
    super('Não foi possível gerar um código único.');
    this.name = 'SlugCollisionError';
  }
}

/**
 * Persiste o link com um slug aleatório. A unicidade é garantida pela
 * restrição UNIQUE do banco; em caso de colisão, tenta novamente com outro
 * slug, até `maxAttempts` vezes.
 */
export async function insertLinkWithUniqueSlug(
  db: Queryable,
  input: NewLinkInput,
  options: { generate?: () => string; maxAttempts?: number } = {},
): Promise<CreatedLink> {
  const generate = options.generate ?? (() => generateSlug());
  const maxAttempts = options.maxAttempts ?? 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const slug = generate();
    try {
      const { rows } = await db.query<{ slug: string; expires_at: Date | null }>(
        `INSERT INTO app.links (slug, destination_url, destination_host, expires_at, creator_ip_hash)
         VALUES ($1, $2, $3, CASE WHEN $4::integer IS NULL THEN NULL ELSE now() + make_interval(secs => $4::integer) END, $5)
         RETURNING slug, expires_at`,
        [slug, input.destinationUrl, input.destinationHost, input.expiresInSeconds, input.creatorIpHash],
      );
      const row = rows[0];
      if (row === undefined) throw new Error('INSERT sem retorno');
      return { slug: row.slug, expiresAt: row.expires_at };
    } catch (error) {
      if (isPgError(error) && error.code === UNIQUE_VIOLATION && error.constraint === 'links_slug_key') continue;
      throw error;
    }
  }
  throw new SlugCollisionError();
}

export interface LinkAccessRow {
  id: string;
  slug: string;
  destination_url: string | null;
  destination_host: string | null;
  status: LinkStatus;
  expires_at: Date | null;
  expired: boolean;
  blocked_domain: string | null;
}

export type AccessState = 'ok' | 'not_found' | 'expired' | 'blocked' | 'deleted';

/** Colunas comuns (estado atual do link, expiração e bloqueio de domínio pelo relógio do banco). */
const ACCESS_COLUMNS = `
  l.id::text AS id, l.slug, l.destination_url, l.destination_host, l.status, l.expires_at,
  (l.expires_at IS NOT NULL AND l.expires_at <= now()) AS expired,
  (SELECT b.domain FROM app.blocked_domains b
    WHERE l.destination_host IS NOT NULL
      AND (l.destination_host = b.domain OR right(l.destination_host, char_length(b.domain) + 1) = '.' || b.domain)
    ORDER BY char_length(b.domain) DESC LIMIT 1) AS blocked_domain`;

export async function findLinkForAccess(db: Queryable, slug: string): Promise<{ link: LinkAccessRow | null; adsEnabled: boolean }> {
  const { rows } = await db.query<LinkAccessRow & { ads_enabled: boolean | null }>(
    `SELECT ${ACCESS_COLUMNS},
            (SELECT s.value = 'true'::jsonb FROM app.app_settings s WHERE s.key = 'ads_enabled') AS ads_enabled
     FROM app.links l WHERE l.slug = $1`,
    [slug],
  );
  const row = rows[0];
  if (row === undefined) {
    // Mesmo sem link, o estado da publicidade não importa (página de erro não tem anúncios).
    return { link: null, adsEnabled: false };
  }
  return { link: row, adsEnabled: row.ads_enabled === true };
}

export function accessState(link: LinkAccessRow | null): AccessState {
  if (link === null) return 'not_found';
  if (link.status === 'deleted') return 'deleted';
  if (link.status === 'blocked' || link.blocked_domain !== null) return 'blocked';
  if (link.expired) return 'expired';
  if (link.destination_url === null) return 'deleted';
  return 'ok';
}

export { ACCESS_COLUMNS };

// ---------------------------------------------------------------------------
// Administração
// ---------------------------------------------------------------------------

export interface AdminLinkRow {
  slug: string;
  destination_url: string | null;
  destination_host: string | null;
  status: LinkStatus;
  status_reason: string | null;
  created_at: Date;
  expires_at: Date | null;
  expired: boolean;
  interstitial_views: string;
  continuations: string;
  open_reports: string;
}

export async function listLinks(
  db: Queryable,
  options: { q: string; status: LinkStatus | 'all'; limit: number; offset: number },
): Promise<AdminLinkRow[]> {
  const q = options.q.trim().toLowerCase();
  const pattern = `%${escapeLike(q)}%`;
  const { rows } = await db.query<AdminLinkRow>(
    `SELECT l.slug, l.destination_url, l.destination_host, l.status, l.status_reason, l.created_at, l.expires_at,
            (l.expires_at IS NOT NULL AND l.expires_at <= now()) AS expired,
            COALESCE((SELECT sum(m.interstitial_views) FROM app.link_daily_metrics m WHERE m.link_id = l.id), 0)::text AS interstitial_views,
            COALESCE((SELECT sum(m.continuations) FROM app.link_daily_metrics m WHERE m.link_id = l.id), 0)::text AS continuations,
            (SELECT count(*) FROM app.reports r WHERE r.link_id = l.id AND r.status = 'open')::text AS open_reports
     FROM app.links l
     WHERE ($1 = 'all' OR l.status = $1)
       AND ($2 = '' OR l.slug = $3 OR l.destination_host LIKE $4 ESCAPE '\\')
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT $5 OFFSET $6`,
    [options.status, q, options.q.trim(), pattern, options.limit, options.offset],
  );
  return rows;
}

export type StatusChange = 'block' | 'unblock' | 'delete';

export type StatusChangeResult =
  | { ok: true; previous: LinkStatus; current: LinkStatus }
  | { ok: false; reason: 'not_found' | 'invalid_transition'; current?: LinkStatus };

/**
 * Altera o estado de forma atômica: o UPDATE só afeta a linha se o estado
 * atual permitir a transição (active→blocked, blocked→active, *→deleted).
 * Exclusão é definitiva: remove o destino e mantém o slug reservado.
 */
export async function changeLinkStatus(db: Queryable, slug: string, change: StatusChange, reason: string | null): Promise<StatusChangeResult> {
  const statements: Record<StatusChange, { sql: string; params: unknown[] }> = {
    block: {
      sql: `UPDATE app.links SET status = 'blocked', status_reason = $2, status_changed_at = now()
            WHERE slug = $1 AND status = 'active' RETURNING id::text AS id`,
      params: [slug, reason],
    },
    unblock: {
      sql: `UPDATE app.links SET status = 'active', status_reason = NULL, status_changed_at = now()
            WHERE slug = $1 AND status = 'blocked' RETURNING id::text AS id`,
      params: [slug],
    },
    delete: {
      sql: `UPDATE app.links SET status = 'deleted', destination_url = NULL, status_reason = $2, status_changed_at = now()
            WHERE slug = $1 AND status <> 'deleted' RETURNING id::text AS id`,
      params: [slug, reason],
    },
  };
  // Em transação, o FOR UPDATE serializa alterações concorrentes do mesmo link.
  const before = await db.query<{ status: LinkStatus }>('SELECT status FROM app.links WHERE slug = $1 FOR UPDATE', [slug]);
  const previous = before.rows[0]?.status;
  if (previous === undefined) return { ok: false, reason: 'not_found' };

  const { rows } = await db.query<{ id: string }>(statements[change].sql, statements[change].params);
  const id = rows[0]?.id;
  if (id === undefined) return { ok: false, reason: 'invalid_transition', current: previous };
  if (change === 'delete') {
    await db.query('DELETE FROM app.continuation_tickets WHERE link_id = $1', [id]);
  }
  const current: LinkStatus = change === 'block' ? 'blocked' : change === 'unblock' ? 'active' : 'deleted';
  return { ok: true, previous, current };
}
