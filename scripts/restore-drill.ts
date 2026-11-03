/**
 * npm run db:restore-drill — ensaio ISOLADO de backup e restauração.
 *
 * 1. Origem:
 *    - padrão: banco local descartável criado aqui, com as migrações reais e
 *      dados de exemplo (links ativos/bloqueados/excluídos, denúncia, domínio
 *      bloqueado, sessão, auditoria);
 *    - com RESTORE_DRILL_SOURCE_URL: um banco existente, usado SOMENTE PARA
 *      LEITURA (pg_dump e SELECT de contagens). Serve para provar que o backup
 *      de produção pode ser restaurado. Nada é escrito na origem.
 * 2. pg_dump --format=custom do schema "app" para um arquivo temporário.
 * 3. pg_restore em um banco NOVO, no servidor de ensaio local (nunca na origem).
 * 4. Verificação: migrações (versão e checksum), contagem de linhas por tabela,
 *    sequências (códigos/IDs nunca reutilizados), RLS ativo e leitura de um
 *    link pelo mesmo código usado pelas funções.
 * 5. Remove o banco restaurado, o banco de origem descartável e o arquivo.
 *
 * Requisitos: pg_dump e pg_restore da MESMA versão principal do servidor de
 * origem (ou mais nova), no PATH ou em PG_BIN_DIR.
 * Servidor de ensaio: RESTORE_DRILL_DATABASE_URL (apenas localhost) ou
 * PostgreSQL embarcado na porta 54333.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { createDatabase } from '../src/server/db/pool.ts';
import { runMigrations } from '../src/server/db/migrate.ts';
import { accessState, changeLinkStatus, findLinkForAccess, insertLinkWithUniqueSlug } from '../src/server/domain/links.ts';
import { addBlockedDomain } from '../src/server/domain/blocked-domains.ts';
import { createReport } from '../src/server/domain/reports.ts';
import { createSession } from '../src/server/domain/sessions.ts';
import { writeAudit } from '../src/server/domain/audit.ts';
import { startLocalPostgres } from './lib/local-postgres.ts';

const repoRoot = resolve(import.meta.dirname, '..');
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];
const SOURCE_DB = 'encurtalinks_drill_source';
const RESTORE_DB = 'encurtalinks_drill_restore';

function redact(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgres://***');
}

function tool(name: 'pg_dump' | 'pg_restore'): string {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  return process.env.PG_BIN_DIR ? join(process.env.PG_BIN_DIR, exe) : exe;
}

function toolVersion(name: 'pg_dump' | 'pg_restore'): string {
  const result = spawnSync(tool(name), ['--version'], { encoding: 'utf8' });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      `${name} não encontrado. Instale as ferramentas cliente do PostgreSQL (mesma versão principal do servidor) ` +
        'e coloque-as no PATH ou defina PG_BIN_DIR.',
    );
  }
  return result.stdout.trim();
}

/** Variáveis libpq a partir da URL: a senha não aparece na linha de comando. */
function libpqEnv(connectionString: string): NodeJS.ProcessEnv {
  const url = new URL(connectionString);
  const sslmode = url.searchParams.get('sslmode');
  return {
    ...process.env,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')),
    ...(sslmode !== null ? { PGSSLMODE: sslmode } : LOCAL_HOSTS.includes(url.hostname) ? { PGSSLMODE: 'disable' } : { PGSSLMODE: 'verify-full' }),
  };
}

function run(name: 'pg_dump' | 'pg_restore', args: string[], connectionString: string): void {
  const result = spawnSync(tool(name), args, { encoding: 'utf8', env: libpqEnv(connectionString) });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`${name} falhou (código ${result.status ?? '?'}): ${redact((result.stderr || result.error?.message || '').trim())}`);
  }
}

function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

async function recreateDatabase(adminUrl: string, database: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    // Nomes fixos definidos neste arquivo (não vêm de entrada externa).
    await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${database}`);
  } finally {
    await client.end();
  }
}

async function dropDatabase(adminUrl: string, database: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

interface Snapshot {
  migrations: string[];
  counts: Record<string, number>;
  sequences: Record<string, string | null>;
  rls: Record<string, boolean>;
}

async function snapshot(connectionString: string, ssl: 'verify' | 'disable'): Promise<Snapshot> {
  const db = createDatabase({ connectionString, ssl, maxConnections: 1, queryTimeoutMs: 60_000 });
  try {
    const migrations = (await db.query<{ v: string }>('SELECT version || \':\' || checksum AS v FROM app.schema_migrations ORDER BY version')).rows.map((r) => r.v);
    const tables = (
      await db.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' AND table_type = 'BASE TABLE' ORDER BY table_name",
      )
    ).rows.map((r) => r.table_name);
    const counts: Record<string, number> = {};
    for (const table of tables) {
      if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`Nome de tabela inesperado: ${table}`);
      const { rows } = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.${table}`);
      counts[table] = Number(rows[0]?.n ?? '0');
    }
    const sequences: Record<string, string | null> = {};
    for (const row of (await db.query<{ sequencename: string; last_value: string | null }>(
      "SELECT sequencename, last_value::text FROM pg_sequences WHERE schemaname = 'app' ORDER BY sequencename",
    )).rows) {
      sequences[row.sequencename] = row.last_value;
    }
    const rls: Record<string, boolean> = {};
    for (const row of (await db.query<{ relname: string; relrowsecurity: boolean }>(
      "SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'app' AND c.relkind = 'r' ORDER BY c.relname",
    )).rows) {
      rls[row.relname] = row.relrowsecurity;
    }
    return { migrations, counts, sequences, rls };
  } finally {
    await db.end();
  }
}

async function seed(connectionString: string): Promise<string> {
  const db = createDatabase({ connectionString, ssl: 'disable', maxConnections: 2 });
  try {
    await runMigrations(db, resolve(repoRoot, 'db', 'migrations'));
    const active = await insertLinkWithUniqueSlug(db, {
      destinationUrl: 'https://www.exemplo-ensaio.com.br/pagina?ref=backup',
      destinationHost: 'www.exemplo-ensaio.com.br',
      expiresInSeconds: null,
      creatorIpHash: null,
    });
    const blocked = await insertLinkWithUniqueSlug(db, {
      destinationUrl: 'https://golpe-ensaio.com.br/',
      destinationHost: 'golpe-ensaio.com.br',
      expiresInSeconds: 86_400,
      creatorIpHash: null,
    });
    const removed = await insertLinkWithUniqueSlug(db, {
      destinationUrl: 'https://removido-ensaio.com.br/',
      destinationHost: 'removido-ensaio.com.br',
      expiresInSeconds: null,
      creatorIpHash: null,
    });
    await createReport(db, { slug: blocked.slug, reason: 'phishing', details: 'ensaio de backup', contactEmail: null, reporterIpHash: null }, 1000);
    await changeLinkStatus(db, blocked.slug, 'block', 'ensaio de backup');
    await changeLinkStatus(db, removed.slug, 'delete', 'ensaio de backup');
    await addBlockedDomain(db, 'dominio-bloqueado-ensaio.com.br', 'ensaio', 'restore-drill');
    await createSession(db, { githubId: 1, login: 'ensaio' }, 3600);
    await writeAudit(db, { githubId: 1, login: 'ensaio' }, 'drill.seed', { type: 'link', id: active.slug }, { ok: true });
    return active.slug;
  } finally {
    await db.end();
  }
}

function compare(source: Snapshot, restored: Snapshot): string[] {
  const problems: string[] = [];
  if (JSON.stringify(source.migrations) !== JSON.stringify(restored.migrations)) problems.push('histórico de migrações diferente');
  for (const [table, count] of Object.entries(source.counts)) {
    if (restored.counts[table] !== count) problems.push(`app.${table}: ${count} linha(s) na origem, ${restored.counts[table] ?? 'tabela ausente'} na restauração`);
  }
  for (const [sequence, value] of Object.entries(source.sequences)) {
    if (restored.sequences[sequence] !== value) problems.push(`sequência ${sequence}: ${value} na origem, ${restored.sequences[sequence]} na restauração`);
  }
  for (const [table, enabled] of Object.entries(source.rls)) {
    if (enabled && restored.rls[table] !== true) problems.push(`RLS desativado em app.${table} após a restauração`);
  }
  return problems;
}

async function main(): Promise<void> {
  console.log(`[ensaio] ${toolVersion('pg_dump')} · ${toolVersion('pg_restore')}`);
  const externalSource = process.env.RESTORE_DRILL_SOURCE_URL;

  const server = await startLocalPostgres({
    dataDir: '.restore-drill-db',
    port: 54333,
    database: 'postgres',
    urlEnv: 'RESTORE_DRILL_DATABASE_URL',
    persistent: false,
  });
  const serverHost = new URL(server.adminConnectionString).hostname;
  if (!LOCAL_HOSTS.includes(serverHost)) throw new Error('O servidor de ensaio deve ser local (localhost): a restauração apaga e recria bancos.');

  const workDir = mkdtempSync(join(tmpdir(), 'encurtalinks-drill-'));
  const dumpFile = join(workDir, 'backup.dump');
  let sourceUrl: string;
  let sourceSsl: 'verify' | 'disable';
  let sampleSlug: string | null = null;
  const restoreUrl = withDatabase(server.adminConnectionString, RESTORE_DB);

  try {
    if (externalSource) {
      sourceUrl = externalSource;
      const host = new URL(externalSource).hostname;
      sourceSsl = LOCAL_HOSTS.includes(host) ? 'disable' : 'verify';
      if (withDatabase(externalSource, 'x') === withDatabase(server.adminConnectionString, 'x')) {
        throw new Error('RESTORE_DRILL_SOURCE_URL não pode apontar para o servidor de ensaio.');
      }
      console.log('[ensaio] origem: banco informado em RESTORE_DRILL_SOURCE_URL (somente leitura)');
    } else {
      await recreateDatabase(server.adminConnectionString, SOURCE_DB);
      sourceUrl = withDatabase(server.adminConnectionString, SOURCE_DB);
      sourceSsl = 'disable';
      sampleSlug = await seed(sourceUrl);
      console.log('[ensaio] origem: banco descartável com migrações e dados de exemplo');
    }

    const before = await snapshot(sourceUrl, sourceSsl);
    const started = Date.now();
    run('pg_dump', ['--format=custom', '--schema=app', '--no-owner', '--no-privileges', '--file', dumpFile], sourceUrl);
    console.log(`[ensaio] backup: ${statSync(dumpFile).size} bytes em ${Date.now() - started} ms`);

    await recreateDatabase(server.adminConnectionString, RESTORE_DB);
    const restoreStarted = Date.now();
    run('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction', '--dbname', RESTORE_DB, dumpFile], restoreUrl);
    console.log(`[ensaio] restauração concluída em ${Date.now() - restoreStarted} ms`);

    const after = await snapshot(restoreUrl, 'disable');
    const problems = compare(before, after);

    if (sampleSlug !== null) {
      const db = createDatabase({ connectionString: restoreUrl, ssl: 'disable', maxConnections: 1 });
      try {
        const { link } = await findLinkForAccess(db, sampleSlug);
        if (accessState(link) !== 'ok' || link?.destination_host !== 'www.exemplo-ensaio.com.br') problems.push('o link de exemplo não pôde ser lido após a restauração');
      } finally {
        await db.end();
      }
    }

    const total = Object.values(before.counts).reduce((sum, n) => sum + n, 0);
    if (problems.length > 0) {
      console.error('[ensaio] FALHOU:');
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exitCode = 1;
    } else {
      console.log(
        `[ensaio] OK: ${before.migrations.length} migração(ões), ${Object.keys(before.counts).length} tabela(s), ${total} linha(s) e ` +
          `${Object.keys(before.sequences).length} sequência(s) idênticas após a restauração.`,
      );
    }
  } finally {
    await dropDatabase(server.adminConnectionString, RESTORE_DB).catch(() => undefined);
    if (!externalSource) await dropDatabase(server.adminConnectionString, SOURCE_DB).catch(() => undefined);
    rmSync(workDir, { recursive: true, force: true });
    await server.stop();
  }
}

main().catch((error: unknown) => {
  console.error(`[ensaio] erro: ${redact(error instanceof Error ? error.message : String(error))}`);
  process.exitCode = 1;
});
