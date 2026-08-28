import { timingSafeEqual } from "node:crypto";
import { renderPrometheusMetrics } from "@/observability/service-metrics";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) return false;

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;

  const provided = header.slice("Bearer ".length);
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function GET(request: Request) {
  if (!process.env.METRICS_TOKEN) {
    return new Response("metrics unavailable\n", { status: 503 });
  }

  if (!authorized(request)) {
    return new Response("unauthorized\n", { status: 401 });
  }

  return new Response(renderPrometheusMetrics(), {
    status: 200,
    headers: {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
