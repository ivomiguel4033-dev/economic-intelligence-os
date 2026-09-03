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
  | "outbox_dead_lettered_total"
  | "outbox_claim_lost_total"
  | "tenant_concurrency_acquired_total"
  | "tenant_concurrency_limited_total"
  | "tenant_concurrency_acquire_failures_total"
  | "tenant_concurrency_release_failures_total";

export type OperationalGaugeKey =
  | "database_pool_total"
  | "database_pool_idle"
  | "database_pool_waiting"
  | "outbox_ready"
  | "outbox_processing"
  | "outbox_failed"
  | "outbox_dead_lettered"
  | "outbox_oldest_ready_age_seconds"
  | "outbox_slo_ready_backlog_threshold"
  | "outbox_slo_failed_messages_threshold"
  | "outbox_slo_oldest_ready_age_seconds_threshold"
  | "outbox_slo_backlog_breached"
  | "outbox_slo_failed_breached"
  | "outbox_slo_dead_letter_breached"
  | "outbox_slo_oldest_ready_age_breached";

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
    outbox_claim_lost_total: counters.get("outbox_claim_lost_total") ?? 0,
    tenant_concurrency_acquired_total: counters.get("tenant_concurrency_acquired_total") ?? 0,
    tenant_concurrency_limited_total: counters.get("tenant_concurrency_limited_total") ?? 0,
    tenant_concurrency_acquire_failures_total: counters.get("tenant_concurrency_acquire_failures_total") ?? 0,
    tenant_concurrency_release_failures_total: counters.get("tenant_concurrency_release_failures_total") ?? 0,
  };
}

export function renderPrometheusMetrics(
  gauges: Partial<Record<OperationalGaugeKey, number>> = {},
): string {
  const snapshot = snapshotMetrics();
  const values: Record<string, number> = { ...snapshot };

  for (const [metric, value] of Object.entries(gauges)) {
    if (Number.isFinite(value) && (value ?? 0) >= 0) values[metric] = value as number;
  }

  return `${Object.entries(values)
    .map(([metric, value]) => `${metric} ${value}`)
    .join("\n")}\n`;
}
