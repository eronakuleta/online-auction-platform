import { Pool } from 'pg';
import type { PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg';

/** Anything that can run a query: the pool, or a client inside a transaction. */
export interface Queryable {
  query<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
}

export function createPool(config: PoolConfig): Pool {
  return new Pool(config);
}

/** Runs the work in one transaction: COMMIT if it returns, ROLLBACK if it throws. */
export async function withTransaction<T>(
  pool: Pool,
  work: (transaction: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function pingDatabase(db: Queryable): Promise<void> {
  await db.query('SELECT 1');
}
