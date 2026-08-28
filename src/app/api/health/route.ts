import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "no-store" };

export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "economic-intelligence-os",
      checks: { application: "ok" },
      timestamp: new Date().toISOString(),
    },
    { status: 200, headers: responseHeaders },
  );
}
