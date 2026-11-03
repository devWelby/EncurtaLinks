import type { Queryable } from '../db/types.ts';

export type LegalKind = 'terms' | 'privacy';

export interface LegalRow {
  kind: LegalKind;
  title: string;
  body: string;
  responsible_name: string | null;
  responsible_contact: string | null;
  responsible_document: string | null;
  updated_at: Date;
  updated_by: string | null;
}

export async function getLegalDocument(db: Queryable, kind: LegalKind): Promise<LegalRow | null> {
  const { rows } = await db.query<LegalRow>(
    `SELECT kind, title, body, responsible_name, responsible_contact, responsible_document, updated_at, updated_by
       FROM app.legal_documents WHERE kind = $1`,
    [kind],
  );
  return rows[0] ?? null;
}

export interface LegalUpdate {
  title: string;
  body: string;
  responsibleName: string | null;
  responsibleContact: string | null;
  responsibleDocument: string | null;
}

export async function updateLegalDocument(db: Queryable, kind: LegalKind, update: LegalUpdate, updatedBy: string): Promise<LegalRow> {
  const { rows } = await db.query<LegalRow>(
    `INSERT INTO app.legal_documents (kind, title, body, responsible_name, responsible_contact, responsible_document, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, now(), $7)
     ON CONFLICT (kind) DO UPDATE SET
       title = EXCLUDED.title, body = EXCLUDED.body,
       responsible_name = EXCLUDED.responsible_name, responsible_contact = EXCLUDED.responsible_contact,
       responsible_document = EXCLUDED.responsible_document, updated_at = now(), updated_by = EXCLUDED.updated_by
     RETURNING kind, title, body, responsible_name, responsible_contact, responsible_document, updated_at, updated_by`,
    [kind, update.title, update.body, update.responsibleName, update.responsibleContact, update.responsibleDocument, updatedBy],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('Falha ao salvar documento');
  return row;
}
