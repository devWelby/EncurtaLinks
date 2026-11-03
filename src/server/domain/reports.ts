import type { Queryable } from '../db/types.ts';
import type { ReportReasonId } from '../../shared/constants.ts';
import { SYSTEM_ACTOR, writeAudit, type Actor } from './audit.ts';

export interface NewReport {
  slug: string;
  reason: ReportReasonId;
  details: string | null;
  contactEmail: string | null;
  reporterIpHash: Buffer | null;
}

export type CreateReportResult = { ok: true; autoBlocked: boolean } | { ok: false; reason: 'link_not_found' };

/**
 * Registra a denúncia. Se `autoBlockThreshold` > 0 e o link receber denúncias
 * abertas de pelo menos esse número de origens distintas em 24 horas, ele é
 * bloqueado automaticamente (o administrador pode desbloquear).
 */
export async function createReport(db: Queryable, input: NewReport, autoBlockThreshold: number): Promise<CreateReportResult> {
  const link = await db.query<{ id: string; status: string }>('SELECT id::text AS id, status FROM app.links WHERE slug = $1', [input.slug]);
  const row = link.rows[0];
  if (row === undefined) return { ok: false, reason: 'link_not_found' };

  await db.query(
    `INSERT INTO app.reports (link_id, slug, reason, details, contact_email, reporter_ip_hash)
     VALUES ($1::bigint, $2, $3, $4, $5, $6)`,
    [row.id, input.slug, input.reason, input.details, input.contactEmail, input.reporterIpHash],
  );

  let autoBlocked = false;
  if (autoBlockThreshold > 0 && row.status === 'active') {
    const sources = await db.query<{ n: string }>(
      `SELECT count(DISTINCT reporter_ip_hash)::text AS n FROM app.reports
        WHERE link_id = $1::bigint AND status = 'open' AND reporter_ip_hash IS NOT NULL AND created_at > now() - interval '24 hours'`,
      [row.id],
    );
    if (Number(sources.rows[0]?.n ?? 0) >= autoBlockThreshold) {
      const updated = await db.query(
        `UPDATE app.links SET status = 'blocked', status_reason = $2, status_changed_at = now()
          WHERE id = $1::bigint AND status = 'active'`,
        [row.id, `Bloqueio automático: denúncias de ${autoBlockThreshold} ou mais origens em 24 horas`],
      );
      autoBlocked = (updated.rowCount ?? 0) > 0;
      if (autoBlocked) {
        await writeAudit(db, SYSTEM_ACTOR, 'link.auto_block', { type: 'link', id: input.slug }, { threshold: autoBlockThreshold });
      }
    }
  }
  return { ok: true, autoBlocked };
}

export interface AdminReportRow {
  id: string;
  slug: string;
  link_status: 'active' | 'blocked' | 'deleted' | null;
  destination_host: string | null;
  reason: ReportReasonId;
  details: string | null;
  contact_email: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  created_at: Date;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

export async function listReports(
  db: Queryable,
  options: { status: 'open' | 'resolved' | 'dismissed' | 'all'; limit: number; offset: number },
): Promise<AdminReportRow[]> {
  const { rows } = await db.query<AdminReportRow>(
    `SELECT r.id::text AS id, r.slug, l.status AS link_status, l.destination_host, r.reason, r.details, r.contact_email,
            r.status, r.created_at, r.resolved_at, r.resolved_by, r.resolution_note
       FROM app.reports r LEFT JOIN app.links l ON l.id = r.link_id
      WHERE ($1 = 'all' OR r.status = $1)
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT $2 OFFSET $3`,
    [options.status, options.limit, options.offset],
  );
  return rows;
}

export type ResolveAction = 'resolve' | 'dismiss';

/** Resolve/descarta uma denúncia aberta (atômico: só altera se ainda estiver aberta). */
export async function resolveReport(
  db: Queryable,
  id: number,
  action: ResolveAction,
  note: string | null,
  actor: Actor,
): Promise<{ ok: true; slug: string } | { ok: false; reason: 'not_found' | 'not_open' }> {
  const { rows } = await db.query<{ slug: string }>(
    `UPDATE app.reports SET status = $2, resolved_at = now(), resolved_by = $3, resolution_note = $4
      WHERE id = $1 AND status = 'open' RETURNING slug`,
    [id, action === 'resolve' ? 'resolved' : 'dismissed', actor.login, note],
  );
  const slug = rows[0]?.slug;
  if (slug !== undefined) return { ok: true, slug };
  const exists = await db.query('SELECT 1 FROM app.reports WHERE id = $1', [id]);
  return { ok: false, reason: (exists.rowCount ?? 0) > 0 ? 'not_open' : 'not_found' };
}
