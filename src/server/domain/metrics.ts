import type { Queryable } from '../db/types.ts';
import { errorKind, logger } from '../logger.ts';

/**
 * Métricas agregadas por dia (UTC).
 *
 * - "interstitial_view": abertura da página intermediária (não é pessoa única;
 *   inclui robôs de pré-visualização de links).
 * - "continuation": continuação confirmada pelo servidor (ticket consumido).
 * - Impressões e receita NÃO são medidas aqui: consulte o painel do Adsterra.
 *
 * Falhas de métricas são registradas em log e nunca interrompem o fluxo.
 */

export type DailyMetric = 'link_created' | 'link_rejected' | 'interstitial_view' | 'continuation' | 'report_created';

export async function recordDailyMetric(db: Queryable, metric: DailyMetric): Promise<void> {
  try {
    await db.query(
      `INSERT INTO app.daily_metrics (day, metric, count) VALUES ((now() AT TIME ZONE 'UTC')::date, $1, 1)
       ON CONFLICT (day, metric) DO UPDATE SET count = app.daily_metrics.count + 1`,
      [metric],
    );
  } catch (error) {
    logger.warn('metric_failed', { kind: errorKind(error), reason: metric });
  }
}

export async function recordLinkMetric(db: Queryable, linkId: string, metric: 'interstitial_view' | 'continuation'): Promise<void> {
  const views = metric === 'interstitial_view' ? 1 : 0;
  const continuations = metric === 'continuation' ? 1 : 0;
  try {
    await db.query(
      `WITH daily AS (
         INSERT INTO app.daily_metrics (day, metric, count) VALUES ((now() AT TIME ZONE 'UTC')::date, $2, 1)
         ON CONFLICT (day, metric) DO UPDATE SET count = app.daily_metrics.count + 1
       )
       INSERT INTO app.link_daily_metrics (link_id, day, interstitial_views, continuations)
       VALUES ($1::bigint, (now() AT TIME ZONE 'UTC')::date, $3, $4)
       ON CONFLICT (link_id, day) DO UPDATE SET
         interstitial_views = app.link_daily_metrics.interstitial_views + EXCLUDED.interstitial_views,
         continuations = app.link_daily_metrics.continuations + EXCLUDED.continuations`,
      [linkId, metric, views, continuations],
    );
  } catch (error) {
    logger.warn('metric_failed', { kind: errorKind(error), reason: metric });
  }
}

export interface MetricsDayRow {
  day: string;
  link_created: string;
  link_rejected: string;
  interstitial_view: string;
  continuation: string;
  report_created: string;
}

export async function getDailyMetrics(db: Queryable, days: number): Promise<MetricsDayRow[]> {
  const { rows } = await db.query<MetricsDayRow>(
    `WITH days AS (
       SELECT generate_series((now() AT TIME ZONE 'UTC')::date - ($1::integer - 1), (now() AT TIME ZONE 'UTC')::date, interval '1 day')::date AS day
     )
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            COALESCE(sum(m.count) FILTER (WHERE m.metric = 'link_created'), 0)::text AS link_created,
            COALESCE(sum(m.count) FILTER (WHERE m.metric = 'link_rejected'), 0)::text AS link_rejected,
            COALESCE(sum(m.count) FILTER (WHERE m.metric = 'interstitial_view'), 0)::text AS interstitial_view,
            COALESCE(sum(m.count) FILTER (WHERE m.metric = 'continuation'), 0)::text AS continuation,
            COALESCE(sum(m.count) FILTER (WHERE m.metric = 'report_created'), 0)::text AS report_created
       FROM days d LEFT JOIN app.daily_metrics m ON m.day = d.day
      GROUP BY d.day ORDER BY d.day DESC`,
    [days],
  );
  return rows;
}

export async function getTotals(db: Queryable): Promise<{
  active_links: string;
  blocked_links: string;
  deleted_links: string;
  open_reports: string;
  blocked_domains: string;
}> {
  const { rows } = await db.query<{
    active_links: string;
    blocked_links: string;
    deleted_links: string;
    open_reports: string;
    blocked_domains: string;
  }>(
    `SELECT
       (SELECT count(*) FROM app.links WHERE status = 'active')::text AS active_links,
       (SELECT count(*) FROM app.links WHERE status = 'blocked')::text AS blocked_links,
       (SELECT count(*) FROM app.links WHERE status = 'deleted')::text AS deleted_links,
       (SELECT count(*) FROM app.reports WHERE status = 'open')::text AS open_reports,
       (SELECT count(*) FROM app.blocked_domains)::text AS blocked_domains`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error('Totais indisponíveis');
  return row;
}
