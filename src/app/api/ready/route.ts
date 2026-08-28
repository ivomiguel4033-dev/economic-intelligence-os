import { NextResponse } from "next/server";
import { db } from "@/infrastructure/database/postgres";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store" };
const databaseCheckTimeoutMs = 2_000;

export async function GET() {
  const started = Date.now();
  try {
    await db.query({ text: "SELECT 1", query_timeout: databaseCheckTimeoutMs });
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
