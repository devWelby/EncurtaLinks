import type { Queryable } from '../db/types.ts';

/**
 * Limitação de uso distribuída com janela fixa, armazenada no PostgreSQL.
 *
 * Cada regra incrementa um contador (bucket, início da janela) com
 * INSERT ... ON CONFLICT DO UPDATE, que é atômico mesmo com muitas instâncias
 * de função concorrentes. Todas as regras de uma verificação vão numa única
 * ida ao banco. O relógio usado é o do banco (now()), igual para todas as
 * instâncias. Tentativas acima do limite também são contadas.
 *
 * Consistência: forte (transação do PostgreSQL). Limitação conhecida: janela
 * fixa permite até 2× o limite na virada da janela.
 */

export interface RateLimitRule {
  /** Identificador da regra, ex.: "create:ip". */
  name: string;
  /** Chave do sujeito, ex.: hash do IP. Use "global" para limites globais. */
  subject: string;
  limit: number;
  windowSeconds: number;
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; rule: string; retryAfterSeconds: number };

export async function checkRateLimits(db: Queryable, rules: readonly RateLimitRule[]): Promise<RateLimitResult> {
  if (rules.length === 0) return { allowed: true };
  const values: unknown[] = [];
  const tuples: string[] = [];
  rules.forEach((rule, index) => {
    if (!Number.isInteger(rule.limit) || rule.limit < 1) throw new Error(`Limite inválido em ${rule.name}`);
    if (!Number.isInteger(rule.windowSeconds) || rule.windowSeconds < 1) throw new Error(`Janela inválida em ${rule.name}`);
    const base = index * 3;
    values.push(`${rule.name}:${rule.subject}`.slice(0, 200), rule.windowSeconds, index);
    tuples.push(`($${base + 1}::text, $${base + 2}::integer, $${base + 3}::integer)`);
  });

  const { rows } = await db.query<{ idx: number; count: number; retry_after: number }>(
    `WITH input (bucket, window_seconds, idx) AS (VALUES ${tuples.join(', ')}),
     windows AS (
       SELECT bucket, window_seconds, idx,
              to_timestamp(floor(extract(epoch FROM now()) / window_seconds) * window_seconds) AS window_start
       FROM input
     ),
     upserted AS (
       INSERT INTO app.rate_limit_counters AS c (bucket, window_start, count, expires_at)
       SELECT bucket, window_start, 1, window_start + make_interval(secs => window_seconds)
       FROM windows
       ON CONFLICT (bucket, window_start) DO UPDATE SET count = c.count + 1
       RETURNING c.bucket, c.window_start, c.count, c.expires_at
     )
     SELECT w.idx,
            u.count,
            GREATEST(1, ceil(extract(epoch FROM (u.expires_at - now()))))::integer AS retry_after
     FROM windows w
     JOIN upserted u ON u.bucket = w.bucket AND u.window_start = w.window_start
     ORDER BY w.idx`,
    values,
  );

  let worst: RateLimitResult = { allowed: true };
  for (const row of rows) {
    const rule = rules[row.idx];
    if (rule === undefined) continue;
    if (row.count > rule.limit) {
      const retry = Number(row.retry_after);
      if (worst.allowed || retry > worst.retryAfterSeconds) {
        worst = { allowed: false, rule: rule.name, retryAfterSeconds: retry };
      }
    }
  }
  return worst;
}
