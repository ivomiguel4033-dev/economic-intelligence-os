import { NextResponse } from "next/server";
import { db } from "@/infrastructure/database/postgres";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    await db.query("SELECT 1");
    return NextResponse.json({ status: "ready", database: "ok", latencyMs: Date.now() - started }, { status: 200 });
  } catch {
    return NextResponse.json({ status: "not_ready", database: "unavailable" }, { status: 503 });
  }
}
