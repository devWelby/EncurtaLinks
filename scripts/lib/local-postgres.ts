/**
 * PostgreSQL local REAL para desenvolvimento e testes.
 *
 * Usa o pacote `embedded-postgres`, que executa os binários oficiais do
 * PostgreSQL (não é um emulador). Se a variável indicada em `urlEnv`
 * estiver definida, usa esse servidor externo (por exemplo, o serviço
 * PostgreSQL do GitHub Actions) e não inicia nenhum processo local.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

export interface LocalPostgres {
  /** URL de conexão para o banco de aplicação (já criado). */
  connectionString: string;
  /** URL de conexão administrativa (banco `postgres`). */
  adminConnectionString: string;
  /** Diretório de binários do PostgreSQL embarcado (pg_dump, pg_restore...), se houver. */
  binDir: string | null;
  stop: () => Promise<void>;
}

export interface LocalPostgresOptions {
  /** Diretório de dados persistente (relativo à raiz do projeto). */
  dataDir: string;
  port: number;
  database: string;
  /** Variável de ambiente que, se definida, aponta para um servidor existente. */
  urlEnv: string;
  /** Mantém os dados entre execuções. */
  persistent: boolean;
}

export async function startLocalPostgres(options: LocalPostgresOptions): Promise<LocalPostgres> {
  const external = process.env[options.urlEnv];
  if (external !== undefined && external !== '') {
    const adminUrl = new URL(external);
    const targetDb = adminUrl.pathname.replace(/^\//, '') || options.database;
    adminUrl.pathname = '/postgres';
    await ensureDatabase(adminUrl.toString(), targetDb);
    const appUrl = new URL(external);
    appUrl.pathname = `/${targetDb}`;
    return {
      connectionString: appUrl.toString(),
      adminConnectionString: adminUrl.toString(),
      binDir: null,
      stop: async () => {},
    };
  }

  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const dataDir = resolve(process.cwd(), options.dataDir);
  mkdirSync(dataDir, { recursive: true });
  const password = 'local-dev-only';
  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password,
    port: options.port,
    persistent: options.persistent,
    onLog: () => {},
    onError: (message: unknown) => {
      const text = String(message);
      if (/error|fatal/i.test(text)) process.stderr.write(`[postgres] ${text}\n`);
    },
  });

  const { existsSync } = await import('node:fs');
  if (!existsSync(resolve(dataDir, 'PG_VERSION'))) {
    await server.initialise();
  }
  await server.start();

  const base = `postgres://postgres:${password}@127.0.0.1:${options.port}`;
  await ensureDatabase(`${base}/postgres`, options.database);

  const binDir = await findEmbeddedBinDir();
  return {
    connectionString: `${base}/${options.database}`,
    adminConnectionString: `${base}/postgres`,
    binDir,
    stop: async () => {
      await server.stop();
    },
  };
}

async function ensureDatabase(adminUrl: string, database: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(database)) {
    throw new Error(`Nome de banco inválido: ${database}`);
  }
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (exists.rowCount === 0) {
      // Identificador validado pela expressão regular acima.
      await client.query(`CREATE DATABASE ${database}`);
    }
  } finally {
    await client.end();
  }
}

async function findEmbeddedBinDir(): Promise<string | null> {
  const { existsSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const platformPackages: Record<string, string> = {
    'win32-x64': '@embedded-postgres/windows-x64',
    'linux-x64': '@embedded-postgres/linux-x64',
    'linux-arm64': '@embedded-postgres/linux-arm64',
    'darwin-x64': '@embedded-postgres/darwin-x64',
    'darwin-arm64': '@embedded-postgres/darwin-arm64',
  };
  const name = platformPackages[`${process.platform}-${process.arch}`];
  if (name === undefined) return null;
  try {
    const pkgJson = require.resolve(`${name}/package.json`);
    const dir = resolve(pkgJson, '..', 'native', 'bin');
    return existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}
