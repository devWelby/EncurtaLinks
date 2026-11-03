import type { Queryable } from '../db/types.ts';
import { randomToken, sha256 } from '../security/crypto.ts';
import { ACCESS_COLUMNS, type LinkAccessRow } from './links.ts';

/**
 * Tickets de continuação.
 *
 * - Token opaco de 32 bytes aleatórios (base64url); o banco guarda só o SHA-256.
 * - Vinculado a um link e a um prazo; consumido uma única vez.
 * - O consumo é um único UPDATE condicional (consumed_at IS NULL): com duas
 *   requisições concorrentes, o PostgreSQL bloqueia a linha e somente uma
 *   delas encontra consumed_at nulo — a outra não afeta nenhuma linha.
 * - O destino nunca é codificado no token; ele é lido do registro persistido.
 *
 * Limites: um ticket NÃO comprova impressão ou visualização de anúncio e NÃO
 * impede que alguém compartilhe diretamente o endereço de destino (que é
 * exibido na própria página intermediária, por transparência).
 */

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isWellFormedTicket(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

export async function issueTicket(db: Queryable, linkId: string, ttlSeconds: number): Promise<string> {
  const token = randomToken(32);
  await db.query(
    `INSERT INTO app.continuation_tickets (token_hash, link_id, expires_at)
     VALUES ($1, $2::bigint, now() + make_interval(secs => $3::integer))`,
    [sha256(token), linkId, ttlSeconds],
  );
  return token;
}

export type ConsumeResult =
  | { consumed: true; link: LinkAccessRow }
  | { consumed: false; reason: 'unknown' | 'already_used' | 'expired' | 'too_early' };

export async function consumeTicket(db: Queryable, token: string, slug: string, minWaitSeconds: number): Promise<ConsumeResult> {
  const hash = sha256(token);
  const { rows } = await db.query<LinkAccessRow>(
    `UPDATE app.continuation_tickets t
        SET consumed_at = now()
       FROM app.links l
      WHERE t.token_hash = $1
        AND t.link_id = l.id
        AND l.slug = $2
        AND t.consumed_at IS NULL
        AND t.expires_at > now()
        AND t.created_at <= now() - make_interval(secs => $3::integer)
      RETURNING ${ACCESS_COLUMNS}`,
    [hash, slug, minWaitSeconds],
  );
  const link = rows[0];
  if (link !== undefined) return { consumed: true, link };

  // Diagnóstico somente para a mensagem ao visitante (não altera estado).
  const diagnosis = await db.query<{ consumed: boolean; expired: boolean; too_early: boolean }>(
    `SELECT t.consumed_at IS NOT NULL AS consumed,
            t.expires_at <= now() AS expired,
            t.created_at > now() - make_interval(secs => $3::integer) AS too_early
       FROM app.continuation_tickets t JOIN app.links l ON l.id = t.link_id
      WHERE t.token_hash = $1 AND l.slug = $2`,
    [hash, slug, minWaitSeconds],
  );
  const info = diagnosis.rows[0];
  if (info === undefined) return { consumed: false, reason: 'unknown' };
  if (info.consumed) return { consumed: false, reason: 'already_used' };
  if (info.expired) return { consumed: false, reason: 'expired' };
  if (info.too_early) return { consumed: false, reason: 'too_early' };
  return { consumed: false, reason: 'unknown' };
}
