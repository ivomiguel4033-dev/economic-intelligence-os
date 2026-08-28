type MetricKey =
  | "http_requests_total"
  | "http_errors_total"
  | "database_failures_total"
  | "ai_requests_total"
  | "ai_failures_total"
  | "execution_succeeded_total"
  | "execution_uncertain_total"
  | "execution_dead_lettered_total"
  | "outbox_claimed_total"
  | "outbox_delivered_total"
  | "outbox_failed_total"
  | "outbox_reclaimed_total"
  | "outbox_dead_lettered_total";

const counters = new Map<MetricKey, number>();

export function incrementMetric(metric: MetricKey, by = 1): void {
  if (!Number.isFinite(by) || by <= 0) return;
  counters.set(metric, (counters.get(metric) ?? 0) + by);
}

export function snapshotMetrics(): Record<MetricKey, number> {
  return {
    http_requests_total: counters.get("http_requests_total") ?? 0,
    http_errors_total: counters.get("http_errors_total") ?? 0,
    database_failures_total: counters.get("database_failures_total") ?? 0,
    ai_requests_total: counters.get("ai_requests_total") ?? 0,
    ai_failures_total: counters.get("ai_failures_total") ?? 0,
    execution_succeeded_total: counters.get("execution_succeeded_total") ?? 0,
    execution_uncertain_total: counters.get("execution_uncertain_total") ?? 0,
    execution_dead_lettered_total: counters.get("execution_dead_lettered_total") ?? 0,
    outbox_claimed_total: counters.get("outbox_claimed_total") ?? 0,
    outbox_delivered_total: counters.get("outbox_delivered_total") ?? 0,
    outbox_failed_total: counters.get("outbox_failed_total") ?? 0,
    outbox_reclaimed_total: counters.get("outbox_reclaimed_total") ?? 0,
    outbox_dead_lettered_total: counters.get("outbox_dead_lettered_total") ?? 0,
  };
}
