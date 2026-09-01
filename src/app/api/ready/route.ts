import { NextResponse } from "next/server";
import { db, getDatabasePoolSnapshot } from "@/infrastructure/database/postgres";
import { isDraining } from "@/operations/drain-state";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store" };
const readinessStatementTimeoutMs = 2_000;

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

export async function GET() {
  if (isDraining()) return notReady("draining");

  // Do not enqueue a health probe behind application traffic when every pool
  // slot is already occupied. Readiness should shed new traffic, not add more
  // pressure to a saturated dependency. Metrics remain aggregate-only.
  const pool = getDatabasePoolSnapshot();
  if (pool.total >= pool.max && pool.idle === 0) {
    return notReady("database_pool_saturated");
  }

  const started = Date.now();
  try {
    // Keep the probe bounded inside PostgreSQL itself. Using SET LOCAL in the
    // same transaction avoids leaking the timeout to another pooled request.
    await db.query(
      `BEGIN; SET LOCAL statement_timeout = '${readinessStatementTimeoutMs}ms'; SELECT 1; COMMIT;`,
    );
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
  }
}
