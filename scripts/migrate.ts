/**
 * Aplica as migrações de db/migrations no banco indicado.
 *
 *   DATABASE_MIGRATION_URL (opcional; preferível: conexão direta, sem pooler)
 *   DATABASE_URL           (usada se a anterior não estiver definida)
 *   DATABASE_SSL=disable   (somente bancos locais)
 *   DATABASE_CA_CERT       (opcional, PEM)
 *
 * Todas as migrações pendentes são aplicadas em uma única transação: ou
 * todas entram, ou nenhuma. A URL do banco nunca é impressa.
 */
import { resolve } from 'node:path';
import { createDatabase } from '../src/server/db/pool.ts';
import { runMigrations } from '../src/server/db/migrate.ts';

const connectionString = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL || '';
if (connectionString === '') {
  console.error('[migrate] DATABASE_URL (ou DATABASE_MIGRATION_URL) não definida. Nada foi alterado.');
  process.exit(1);
}

const isProductionBuild = process.env.CONTEXT === 'production';
const ssl = process.env.DATABASE_SSL === 'disable' ? 'disable' : 'verify';
if (ssl === 'disable' && isProductionBuild) {
  console.error('[migrate] DATABASE_SSL=disable não é permitido no build de produção.');
  process.exit(1);
}

const db = createDatabase({
  connectionString,
  ssl,
  caCert: process.env.DATABASE_CA_CERT?.replace(/\n/g, '\n'),
  maxConnections: 1,
  connectionTimeoutMs: 15_000,
  queryTimeoutMs: 120_000,
});

try {
  const report = await runMigrations(db, resolve(import.meta.dirname, '..', 'db', 'migrations'));
  if (report.applied.length === 0) {
    console.log(`[migrate] Banco atualizado (${report.alreadyApplied.length} migração(ões) já aplicada(s)).`);
  } else {
    console.log(`[migrate] Aplicadas: ${report.applied.join(', ')}`);
  }
} catch (error) {
  // Mensagem do erro sem a string de conexão.
  const message = error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/gi, '[url omitida]') : 'erro desconhecido';
  console.error(`[migrate] Falha: ${message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
