import { Pool } from "pg";
import { log } from "../../observability/structured-log.ts";

let pool: Pool | undefined;

function databasePoolMax(): number {
  const configured = Number(process.env.DATABASE_POOL_MAX ?? "10");
  if (!Number.isSafeInteger(configured) || configured < 1) return 10;
  // Bound per-process concurrency so a bad deployment value cannot exhaust
  // the shared PostgreSQL connection budget across horizontally scaled replicas.
  return Math.min(configured, 50);
}

function databasePoolMaxLifetimeSeconds(): number {
  const configured = Number(process.env.DATABASE_POOL_MAX_LIFETIME_SECONDS ?? "300");
  if (!Number.isSafeInteger(configured) || configured < 60) return 300;
  // Keep recycling frequent enough to recover from stale infrastructure state,
  // while preventing an accidental value from retaining sessions indefinitely.
  return Math.min(configured, 1_800);
}

function database(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required at runtime");
  pool = new Pool({
    connectionString,
    application_name: "economic-intelligence-os",
    max: databasePoolMax(),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Recycle long-lived sessions so DNS/failover changes, credential rotation,
    // and intermediary connection state are picked up without a full restart.
    maxLifetimeSeconds: databasePoolMaxLifetimeSeconds(),
    // Detect half-open database sockets promptly after network or failover
    // events instead of leaving stale sessions occupying shared pool capacity.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    idle_in_transaction_session_timeout: 30_000,
  });
  // pg emits an `error` event when an idle pooled client fails unexpectedly.
  // EventEmitter treats an unhandled `error` as fatal, so always consume it;
  // pg removes the failed client from the pool and subsequent work reconnects.
  // Keep the event structured and deliberately omit the raw error message so
  // connection details cannot leak into centralized production logs.
  pool.on("error", (error) => {
    const databaseError = error as Error & { code?: string };
    log("error", {
      event: "postgres.pool.idle_client_error",
      metadata: {
        name: databaseError.name,
        code: databaseError.code,
      },
    });
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

export const db: Pick<Pool, "query" | "connect"> = {
  query: ((...args: unknown[]) => {
    const query = database().query.bind(database()) as (...queryArgs: unknown[]) => unknown;
    return query(...args);
  }) as Pool["query"],
  connect: (() => database().connect()) as Pool["connect"],
};
