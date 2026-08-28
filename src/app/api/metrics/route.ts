import { timingSafeEqual } from "node:crypto";
import { getOutboxOperationalSnapshot } from "@/execution/transactional-outbox";
import {
  renderPrometheusMetrics,
  type OperationalGaugeKey,
} from "@/observability/service-metrics";
import {
  evaluateOutboxSlo,
  getOutboxSloThresholds,
} from "@/operations/operational-slo";

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

  let gauges: Partial<Record<OperationalGaugeKey, number>> = {};
  try {
    const outbox = await getOutboxOperationalSnapshot();
    const thresholds = getOutboxSloThresholds();
    const slo = evaluateOutboxSlo(outbox, thresholds);

    gauges = {
      outbox_ready: outbox.ready,
      outbox_processing: outbox.processing,
      outbox_failed: outbox.failed,
      outbox_dead_lettered: outbox.deadLettered,
      outbox_oldest_ready_age_seconds: outbox.oldestReadyAgeSeconds,
      outbox_slo_ready_backlog_threshold: thresholds.readyBacklog,
      outbox_slo_failed_messages_threshold: thresholds.failedMessages,
      outbox_slo_oldest_ready_age_seconds_threshold: thresholds.oldestReadyAgeSeconds,
      outbox_slo_backlog_breached: slo.backlogBreached ? 1 : 0,
      outbox_slo_failed_breached: slo.failedBreached ? 1 : 0,
      outbox_slo_dead_letter_breached: slo.deadLetterBreached ? 1 : 0,
      outbox_slo_oldest_ready_age_breached: slo.oldestReadyAgeBreached ? 1 : 0,
    };
  } catch {
    // Counter metrics remain available if the database snapshot is temporarily unavailable.
  }

  return new Response(renderPrometheusMetrics(gauges), {
    status: 200,
    headers: {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
