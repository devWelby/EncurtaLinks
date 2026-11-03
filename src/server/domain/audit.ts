import type { Queryable } from '../db/types.ts';

export interface Actor {
  githubId: number;
  login: string;
}

/** Ator usado para ações automáticas (ex.: bloqueio por excesso de denúncias). */
export const SYSTEM_ACTOR: Actor = { githubId: 0, login: 'sistema' };

export async function writeAudit(
  db: Queryable,
  actor: Actor,
  action: string,
  target: { type: string; id: string } | null,
  details: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  await db.query(
    `INSERT INTO app.admin_audit_log (admin_github_id, admin_login, action, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [actor.githubId, actor.login, action, target?.type ?? null, target?.id ?? null, JSON.stringify(details)],
  );
}

export interface AuditRow {
  id: string;
  created_at: Date;
  admin_login: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
}

export async function listAudit(db: Queryable, limit: number, offset: number): Promise<AuditRow[]> {
  const { rows } = await db.query<AuditRow>(
    `SELECT id::text AS id, created_at, admin_login, action, target_type, target_id, details
       FROM app.admin_audit_log ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows;
}
