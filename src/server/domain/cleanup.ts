import type { Database } from '../db/types.ts';

/**
 * Limpeza e retenção (executada diariamente pela função agendada).
 * Os prazos estão documentados na política de privacidade e em docs/operacao.md.
 */
export const RETENTION = {
  ipHashDays: 30,
  reportEmailDaysAfterResolution: 180,
  expiredLinkDestinationDays: 180,
  linkMetricsDays: 400,
  sessionsDays: 30,
  ticketsGraceHours: 24,
} as const;

// `type` (e não `interface`) para que Object.values() preserve o tipo numérico.
export type CleanupReport = {
  tickets: number;
  rateLimitCounters: number;
  linkIpHashes: number;
  reportIpHashes: number;
  reportEmails: number;
  expiredLinksPurged: number;
  linkMetrics: number;
  sessions: number;
};

export async function runCleanup(db: Database): Promise<CleanupReport> {
  return db.transaction(async (tx) => {
    const count = async (sql: string, params: unknown[] = []): Promise<number> => (await tx.query(sql, params)).rowCount ?? 0;
    return {
      tickets: await count(
        `DELETE FROM app.continuation_tickets WHERE expires_at < now() - make_interval(hours => $1::integer)`,
        [RETENTION.ticketsGraceHours],
      ),
      rateLimitCounters: await count('DELETE FROM app.rate_limit_counters WHERE expires_at < now()'),
      linkIpHashes: await count(
        `UPDATE app.links SET creator_ip_hash = NULL WHERE creator_ip_hash IS NOT NULL AND created_at < now() - make_interval(days => $1::integer)`,
        [RETENTION.ipHashDays],
      ),
      reportIpHashes: await count(
        `UPDATE app.reports SET reporter_ip_hash = NULL WHERE reporter_ip_hash IS NOT NULL AND created_at < now() - make_interval(days => $1::integer)`,
        [RETENTION.ipHashDays],
      ),
      reportEmails: await count(
        `UPDATE app.reports SET contact_email = NULL
          WHERE contact_email IS NOT NULL AND resolved_at IS NOT NULL AND resolved_at < now() - make_interval(days => $1::integer)`,
        [RETENTION.reportEmailDaysAfterResolution],
      ),
      // O slug permanece reservado (tombstone); apenas o destino é removido.
      expiredLinksPurged: await count(
        `UPDATE app.links SET status = 'deleted', destination_url = NULL, status_reason = 'Retenção: expirado', status_changed_at = now()
          WHERE status <> 'deleted' AND expires_at IS NOT NULL AND expires_at < now() - make_interval(days => $1::integer)`,
        [RETENTION.expiredLinkDestinationDays],
      ),
      linkMetrics: await count(
        `DELETE FROM app.link_daily_metrics WHERE day < (now() AT TIME ZONE 'UTC')::date - $1::integer`,
        [RETENTION.linkMetricsDays],
      ),
      sessions: await count(
        `DELETE FROM app.admin_sessions WHERE expires_at < now() - make_interval(days => $1::integer)
            OR (revoked_at IS NOT NULL AND revoked_at < now() - make_interval(days => $1::integer))`,
        [RETENTION.sessionsDays],
      ),
    };
  });
}
