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

function databasePoolConnectionTimeoutMillis(): number {
  const configured = Number(process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ?? "5000");
  if (!Number.isSafeInteger(configured) || configured < 250) return 5_000;
  // Bound acquisition/handshake waits so a degraded database cannot hold
  // application work indefinitely, while allowing slower managed failovers.
  return Math.min(configured, 30_000);
}

function databasePoolIdleTimeoutMillis(): number {
  const configured = Number(process.env.DATABASE_POOL_IDLE_TIMEOUT_MS ?? "30000");
  if (!Number.isSafeInteger(configured) || configured < 1_000) return 30_000;
  // Release unused sessions predictably so horizontally scaled replicas do not
  // retain an unnecessarily large share of the shared database connection budget.
  return Math.min(configured, 300_000);
}

function databaseStatementTimeoutMillis(): number {
  const configured = Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? "30000");
  if (!Number.isSafeInteger(configured) || configured < 1_000) return 30_000;
  // Bound server-side statement execution so pathological queries cannot retain
  // shared connections indefinitely; keep the ceiling conservative for API work.
  return Math.min(configured, 120_000);
}

function databaseQueryTimeoutMillis(): number {
  const configured = Number(process.env.DATABASE_QUERY_TIMEOUT_MS ?? "35000");
  if (!Number.isSafeInteger(configured) || configured < 1_000) return 35_000;
  // Keep the client-side query watchdog finite as a second line of defence when
  // server-side cancellation is unavailable or delayed during database failure.
  return Math.min(configured, 125_000);
}

function databaseIdleInTransactionTimeoutMillis(): number {
  const configured = Number(process.env.DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS ?? "30000");
  if (!Number.isSafeInteger(configured) || configured < 5_000) return 30_000;
  // Bound abandoned transactions so they cannot retain locks or prevent vacuum
  // progress indefinitely, while allowing legitimate multi-statement operations.
  return Math.min(configured, 120_000);
}

function databaseLockTimeoutMillis(): number {
  const configured = Number(process.env.DATABASE_LOCK_TIMEOUT_MS ?? "5000");
  if (!Number.isSafeInteger(configured) || configured < 250) return 5_000;
  // Fail boundedly when another transaction holds a conflicting lock instead of
  // allowing lock contention to consume the request and connection budgets.
  return Math.min(configured, 30_000);
}

function database(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required at runtime");
  pool = new Pool({
    connectionString,
    application_name: "economic-intelligence-os",
    max: databasePoolMax(),
    idleTimeoutMillis: databasePoolIdleTimeoutMillis(),
    connectionTimeoutMillis: databasePoolConnectionTimeoutMillis(),
    // Recycle long-lived sessions so DNS/failover changes, credential rotation,
    // and intermediary connection state are picked up without a full restart.
    maxLifetimeSeconds: databasePoolMaxLifetimeSeconds(),
    // Detect half-open database sockets promptly after network or failover
    // events instead of leaving stale sessions occupying shared pool capacity.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    statement_timeout: databaseStatementTimeoutMillis(),
    query_timeout: databaseQueryTimeoutMillis(),
    idle_in_transaction_session_timeout: databaseIdleInTransactionTimeoutMillis(),
    lock_timeout: databaseLockTimeoutMillis(),
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
