import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ready",
    service: "economic-intelligence-os",
    timestamp: new Date().toISOString(),
  });
}
