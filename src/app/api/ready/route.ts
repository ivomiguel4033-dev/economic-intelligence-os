import { NextResponse } from "next/server";
import { db } from "@/infrastructure/database/postgres";
import { isDraining } from "@/operations/drain-state";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store" };
const readinessStatementTimeoutMs = 2_000;

export async function GET() {
  if (isDraining()) {
    return NextResponse.json(
      {
        status: "not_ready",
        service: "economic-intelligence-os",
        reason: "draining",
        timestamp: new Date().toISOString(),
      },
      { status: 503, headers: { ...responseHeaders, "Retry-After": "1" } },
    );
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
