import { NextResponse } from "next/server";
import { db } from "@/infrastructure/database/postgres";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store" };

export async function GET() {
  const started = Date.now();
  try {
    await db.query("SELECT 1");
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
