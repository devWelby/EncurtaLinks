import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from './types.ts';

const MIGRATION_NAME = /^(\d{4,})_([a-z0-9_-]+)\.sql$/;
/** Chave fixa do advisory lock que serializa execuções concorrentes do migrador. */
const MIGRATION_LOCK_KEY = 7_202_611_021;

export interface MigrationFile {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export async function loadMigrations(directory: string): Promise<MigrationFile[]> {
  const entries = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  const migrations: MigrationFile[] = [];
  for (const file of entries) {
    const match = MIGRATION_NAME.exec(file);
    if (!match) throw new Error(`Nome de migração inválido: ${file} (use 0001_descricao.sql)`);
    // Fins de linha normalizados: o checksum não muda entre Windows (CRLF) e Linux (LF).
    const sql = (await readFile(join(directory, file), 'utf8')).replace(/
/g, '
');
    migrations.push({
      version: match[1] ?? '',
      name: match[2] ?? '',
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  const versions = new Set(migrations.map((m) => m.version));
  if (versions.size !== migrations.length) throw new Error('Há migrações com a mesma versão.');
  return migrations;
}

export interface MigrationReport {
  applied: string[];
  alreadyApplied: string[];
}

/**
 * Aplica migrações pendentes em ordem, todas numa única transação
 * (tudo ou nada); um advisory lock impede execuções simultâneas; migrações
 * já aplicadas têm o checksum conferido para detectar edições indevidas.
 */
export async function runMigrations(db: Database, directory: string): Promise<MigrationReport> {
  const migrations = await loadMigrations(directory);
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
    await tx.query('CREATE SCHEMA IF NOT EXISTS app');
    await tx.query(`
      CREATE TABLE IF NOT EXISTS app.schema_migrations (
        version    text        PRIMARY KEY,
        name       text        NOT NULL,
        checksum   text        NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    await tx.query('ALTER TABLE app.schema_migrations ENABLE ROW LEVEL SECURITY');

    const { rows } = await tx.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM app.schema_migrations ORDER BY version',
    );
    const applied = new Map(rows.map((row) => [row.version, row.checksum]));
    const known = new Set(migrations.map((m) => m.version));
    for (const version of applied.keys()) {
      if (!known.has(version)) {
        throw new Error(`O banco tem a migração ${version}, que não existe neste código. Atualize o código antes de migrar.`);
      }
    }

    const report: MigrationReport = { applied: [], alreadyApplied: [] };
    for (const migration of migrations) {
      const existing = applied.get(migration.version);
      if (existing !== undefined) {
        if (existing !== migration.checksum) {
          throw new Error(`A migração ${migration.version}_${migration.name} foi alterada depois de aplicada. Crie uma nova migração.`);
        }
        report.alreadyApplied.push(migration.version);
        continue;
      }
      // Um erro aqui desfaz todas as migrações desta execução.
      await tx.query(migration.sql);
      await tx.query('INSERT INTO app.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
        migration.version,
        migration.name,
        migration.checksum,
      ]);
      report.applied.push(`${migration.version}_${migration.name}`);
    }
    return report;
  });
}
