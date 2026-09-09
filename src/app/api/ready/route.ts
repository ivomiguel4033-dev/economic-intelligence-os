import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { db, getDatabasePoolSnapshot } from "@/infrastructure/database/postgres";
import { isDraining } from "@/operations/drain-state";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store" };
// Keep the server-side cancellation deadline below the client-side guard so
// PostgreSQL normally cancels a slow probe while the protocol is still usable.
// The outer query timeout remains the final safety net for network stalls.
const readinessStatementTimeoutMs = 1_500;
const readinessConnectionTimeoutMs = 1_000;
const readinessQueryTimeoutMs = 2_000;

class ReadinessQueryTimeoutError extends Error {
  constructor() {
    super("Readiness database query timed out");
    this.name = "ReadinessQueryTimeoutError";
  }
}

function notReady(reason: string) {
  return NextResponse.json(
    {
      status: "not_ready",
      service: "economic-intelligence-os",
      reason,
      timestamp: new Date().toISOString(),
    },
    { status: 503, headers: { ...responseHeaders, "Retry-After": "1" } },
  );
}

async function connectForReadiness(): Promise<PoolClient> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const connection = db.connect();

  try {
    return await Promise.race([
      connection,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          timedOut = true;
          reject(new Error("Readiness database connection timed out"));
        }, readinessConnectionTimeoutMs);
        timeout.unref?.();
      }),
    ]);
  } catch (error) {
    if (timedOut) {
      // pg Pool does not expose cancellation for an already queued connect().
      // If readiness abandons the wait, immediately return any session that is
      // allocated later so a timed-out probe cannot leak pool capacity.
      void connection
        .then((lateClient) => lateClient.release())
        .catch(() => undefined);
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function queryForReadiness(
  client: PoolClient,
  text: string,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const query = client.query(text);

  try {
    await Promise.race([
      query,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          timedOut = true;
          reject(new ReadinessQueryTimeoutError());
        }, readinessQueryTimeoutMs);
        timeout.unref?.();
      }),
    ]);
  } catch (error) {
    if (timedOut) {
      // A timed-out query can still be running on the server. Destroy this
      // session rather than returning a potentially desynchronised connection
      // to the shared application pool, and absorb its eventual rejection.
      client.release(true);
      void query.catch(() => undefined);
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function GET() {
  if (isDraining()) return notReady("draining");

  // Do not enqueue a health probe behind application traffic when every pool
  // slot is already occupied. Readiness should shed new traffic, not add more
  // pressure to a saturated dependency. Metrics remain aggregate-only.
  const pool = getDatabasePoolSnapshot();
  if (pool.waiting > 0 || (pool.total >= pool.max && pool.idle === 0)) {
    return notReady("database_pool_saturated");
  }

  const started = Date.now();
  let client: PoolClient | undefined;
  let transactionStarted = false;
  try {
    // The pool's general connection timeout is intentionally more tolerant for
    // application work. Readiness must answer faster so an unhealthy instance
    // is removed from traffic before probes themselves accumulate in the pool.
    client = await connectForReadiness();
    await queryForReadiness(client, "BEGIN");
    transactionStarted = true;
    await queryForReadiness(client, `SET LOCAL statement_timeout = '${readinessStatementTimeoutMs}ms'`);
    await queryForReadiness(client, "SELECT 1");
    await queryForReadiness(client, "COMMIT");
    transactionStarted = false;

    return NextResponse.json(
      {
        status: "ready",
        service: "economic-intelligence-os",
        dependencies: {
          database: { status: "ok", latencyMs: Date.now() - started },
        },
        timestamp: new Date().toISOString(),
      },
      { status: 200, headers: responseHeaders },
    );
  } catch (error) {
    if (error instanceof ReadinessQueryTimeoutError) {
      // queryForReadiness has already destroyed this connection because its
      // protocol state cannot be trusted after abandoning an in-flight query.
      client = undefined;
      transactionStarted = false;
    } else if (client && transactionStarted) {
      try {
        await queryForReadiness(client, "ROLLBACK");
      } catch {
        // The probe is already unhealthy. release(true) below discards a
        // connection whose transaction state could not be recovered safely.
        client.release(true);
        client = undefined;
      }
    }

    return NextResponse.json(
      {
        status: "not_ready",
        service: "economic-intelligence-os",
        dependencies: {
          database: { status: "unavailable" },
        },
        timestamp: new Date().toISOString(),
      },
      { status: 503, headers: { ...responseHeaders, "Retry-After": "1" } },
    );
  } finally {
    client?.release();
  }
}
