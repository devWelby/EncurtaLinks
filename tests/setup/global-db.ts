import { resolve } from 'node:path';
import type { TestProject } from 'vitest/node';
import { startLocalPostgres } from '../../scripts/lib/local-postgres.ts';
import { runMigrations } from '../../src/server/db/migrate.ts';
import { createDatabase } from '../../src/server/db/pool.ts';

/**
 * Sobe o PostgreSQL de teste, recria o schema "app" do zero e aplica as
 * migrações reais. Por segurança, recusa servidores que não sejam locais:
 * os testes NUNCA podem apagar um banco remoto (ex.: produção).
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const external = process.env.TEST_DATABASE_URL;
  if (external) {
    const host = new URL(external).hostname;
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
      throw new Error('TEST_DATABASE_URL deve apontar para um servidor local (localhost). Os testes apagam o schema "app".');
    }
  }

  const server = await startLocalPostgres({
    dataDir: '.test-db/vitest',
    port: 54331,
    database: 'encurtalinks_test',
    urlEnv: 'TEST_DATABASE_URL',
    persistent: false,
  });

  const db = createDatabase({ connectionString: server.connectionString, ssl: 'disable', maxConnections: 1 });
  try {
    await db.query('DROP SCHEMA IF EXISTS app CASCADE');
    await runMigrations(db, resolve(import.meta.dirname, '..', '..', 'db', 'migrations'));
  } finally {
    await db.end();
  }

  project.provide('databaseUrl', server.connectionString);
  return async () => {
    await server.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
