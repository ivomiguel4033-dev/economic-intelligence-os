import { NextResponse } from "next/server";
import { db, getDatabasePoolSnapshot } from "@/infrastructure/database/postgres";
import { isDraining } from "@/operations/drain-state";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store" };
const readinessStatementTimeoutMs = 2_000;
const readinessConnectionTimeoutMs = 1_000;

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

async function connectForReadiness() {
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
  let client;
  let transactionStarted = false;
  try {
    // The pool's general connection timeout is intentionally more tolerant for
    // application work. Readiness must answer faster so an unhealthy instance
    // is removed from traffic before probes themselves accumulate in the pool.
    client = await connectForReadiness();
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query(`SET LOCAL statement_timeout = '${readinessStatementTimeoutMs}ms'`);
    await client.query("SELECT 1");
    await client.query("COMMIT");
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
  } catch {
    if (client && transactionStarted) {
      try {
        await client.query("ROLLBACK");
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
