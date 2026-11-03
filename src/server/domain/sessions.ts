import type { Queryable } from '../db/types.ts';
import { randomToken, sha256 } from '../security/crypto.ts';

/**
 * Sessões administrativas no servidor.
 *  - O cookie contém um token aleatório de 32 bytes; o banco guarda só o SHA-256.
 *  - Expiração absoluta e por inatividade, verificadas pelo relógio do banco.
 *  - Revogação individual (logout) ou de todas as sessões de um administrador.
 *  - Token CSRF (padrão "synchronizer token") por sessão.
 */

export interface AdminSession {
  githubId: number;
  login: string;
  csrfToken: string;
  expiresAt: Date;
}

export async function createSession(
  db: Queryable,
  admin: { githubId: number; login: string },
  absoluteTtlSeconds: number,
): Promise<{ token: string; session: AdminSession }> {
  const token = randomToken(32);
  const csrfToken = randomToken(32);
  const { rows } = await db.query<{ expires_at: Date }>(
    `INSERT INTO app.admin_sessions (token_hash, csrf_token, admin_github_id, admin_login, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5::integer)) RETURNING expires_at`,
    [sha256(token), csrfToken, admin.githubId, admin.login.slice(0, 100), absoluteTtlSeconds],
  );
  const expiresAt = rows[0]?.expires_at;
  if (expiresAt === undefined) throw new Error('Falha ao criar sessão');
  return { token, session: { githubId: admin.githubId, login: admin.login, csrfToken, expiresAt } };
}

export async function validateSession(db: Queryable, token: string, idleTimeoutSeconds: number): Promise<AdminSession | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { rows } = await db.query<{ admin_github_id: string; admin_login: string; csrf_token: string; expires_at: Date }>(
    `UPDATE app.admin_sessions SET last_seen_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
        AND last_seen_at > now() - make_interval(secs => $2::integer)
      RETURNING admin_github_id::text AS admin_github_id, admin_login, csrf_token, expires_at`,
    [sha256(token), idleTimeoutSeconds],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return { githubId: Number(row.admin_github_id), login: row.admin_login, csrfToken: row.csrf_token, expiresAt: row.expires_at };
}

export async function revokeSession(db: Queryable, token: string): Promise<void> {
  await db.query('UPDATE app.admin_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(token)]);
}

export async function revokeAllSessions(db: Queryable, githubId: number): Promise<number> {
  const { rowCount } = await db.query(
    'UPDATE app.admin_sessions SET revoked_at = now() WHERE admin_github_id = $1 AND revoked_at IS NULL',
    [githubId],
  );
  return rowCount ?? 0;
}
