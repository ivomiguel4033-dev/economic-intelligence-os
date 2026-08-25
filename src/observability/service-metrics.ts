type MetricKey = "http_requests_total" | "http_errors_total" | "database_failures_total" | "ai_requests_total" | "ai_failures_total";

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
  };
}
