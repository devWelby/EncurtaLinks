import pg from 'pg';
import type { Database, Queryable } from './types.ts';

export interface DatabaseOptions {
  connectionString: string;
  /** `verify` exige TLS com verificação de certificado; `disable` só é aceito fora de produção. */
  ssl: 'verify' | 'disable';
  /** Certificado de CA em PEM, para provedores cuja CA não está no repositório padrão. */
  caCert?: string | undefined;
  /** Conexões por instância de função. Funções serverless devem usar valores baixos. */
  maxConnections?: number;
  connectionTimeoutMs?: number;
  queryTimeoutMs?: number;
}

/**
 * Cria o acesso ao PostgreSQL com parâmetros adequados a funções serverless:
 * poucas conexões por instância, timeouts curtos e liberação rápida de
 * conexões ociosas. Use, de preferência, o endpoint com pooling do provedor
 * (ex.: host "-pooler" do Neon ou porta 6543 do Supabase).
 */
export function createDatabase(options: DatabaseOptions): Database {
  const url = new URL(options.connectionString);
  // A configuração de TLS é definida explicitamente abaixo; removemos
  // parâmetros da URL para evitar interpretações divergentes.
  url.searchParams.delete('sslmode');
  url.searchParams.delete('sslrootcert');
  url.searchParams.delete('channel_binding');

  const pool = new pg.Pool({
    connectionString: url.toString(),
    max: options.maxConnections ?? 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    query_timeout: options.queryTimeoutMs ?? 8_000,
    allowExitOnIdle: true,
    application_name: 'encurtalinks',
    ssl:
      options.ssl === 'disable'
        ? false
        : { rejectUnauthorized: true, ...(options.caCert ? { ca: options.caCert } : {}) },
  });

  // Erros em conexões ociosas não podem derrubar o processo.
  pool.on('error', (error: Error) => {
    console.error(JSON.stringify({ level: 'error', event: 'db_pool_error', message: error.message }));
  });

  const database: Database = {
    query: (text, values) => pool.query(text, values === undefined ? undefined : [...values]),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx: Queryable = {
          query: (text, values) => client.query(text, values === undefined ? undefined : [...values]),
        };
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // A conexão pode estar quebrada; ela será descartada abaixo.
        }
        throw error;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
  return database;
}

/** Código de erro do PostgreSQL para violação de UNIQUE. */
export const UNIQUE_VIOLATION = '23505';

export function isPgError(error: unknown): error is { code: string; constraint?: string } {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string';
}
