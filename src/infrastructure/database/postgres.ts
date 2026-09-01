import { Pool } from "pg";

let pool: Pool | undefined;

function database(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required at runtime");
  pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    idle_in_transaction_session_timeout: 30_000,
  });
  return pool;
}

export type DatabasePoolSnapshot = {
  total: number;
  idle: number;
  waiting: number;
};

export function getDatabasePoolSnapshot(): DatabasePoolSnapshot {
  const current = database();
  return {
    total: current.totalCount,
    idle: current.idleCount,
    waiting: current.waitingCount,
  };
}

export const db: Pick<Pool, "query"> = {
  query: ((...args: unknown[]) => {
    const query = database().query.bind(database()) as (...queryArgs: unknown[]) => unknown;
    return query(...args);
  }) as Pool["query"],
};
