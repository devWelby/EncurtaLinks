import type { QueryResultRow } from 'pg';

/**
 * Interface mínima de consulta. É implementada por `pg.Pool` e `pg.PoolClient`,
 * o que permite usar as mesmas funções dentro e fora de transações.
 * Todas as consultas usam parâmetros posicionais ($1, $2...) — nunca
 * concatene valores de entrada no texto SQL.
 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

export interface Database extends Queryable {
  /** Executa `fn` dentro de uma transação (BEGIN/COMMIT, ROLLBACK em erro). */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}
