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
  active: number;
  waiting: number;
  max: number;
};

export function getDatabasePoolSnapshot(): DatabasePoolSnapshot {
  const current = database();
  const total = current.totalCount;
  const idle = current.idleCount;
  return {
    total,
    idle,
    active: Math.max(total - idle, 0),
    waiting: current.waitingCount,
    max: current.options.max ?? 10,
  };
}

export const db: Pick<Pool, "query"> = {
  query: ((...args: unknown[]) => {
    const query = database().query.bind(database()) as (...queryArgs: unknown[]) => unknown;
    return query(...args);
  }) as Pool["query"],
};
