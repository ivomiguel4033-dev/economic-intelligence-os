import fs from "node:fs";

const outboxRulesPath = "ops/prometheus/outbox-alerts.yml";
const databaseRulesPath = "ops/prometheus/database-alerts.yml";
const tenantConcurrencyRulesPath = "ops/prometheus/tenant-concurrency-alerts.yml";
const metricsPath = "src/observability/service-metrics.ts";
const runbookPath = "docs/PRODUCTION_RUNBOOK.md";

const outboxRules = fs.readFileSync(outboxRulesPath, "utf8");
const databaseRules = fs.readFileSync(databaseRulesPath, "utf8");
const tenantConcurrencyRules = fs.readFileSync(tenantConcurrencyRulesPath, "utf8");
const metrics = fs.readFileSync(metricsPath, "utf8");
const runbook = fs.readFileSync(runbookPath, "utf8");

const requiredAlerts = [
  ["OutboxDeadLetterPresent", "outbox_slo_dead_letter_breached"],
  ["OutboxBacklogSloBreached", "outbox_slo_backlog_breached"],
  ["OutboxFailedMessagesSloBreached", "outbox_slo_failed_breached"],
  ["OutboxOldestReadyAgeSloBreached", "outbox_slo_oldest_ready_age_breached"],
];

for (const [alertName, metricName] of requiredAlerts) {
  if (!outboxRules.includes(`alert: ${alertName}`)) {
    throw new Error(`Missing alert rule: ${alertName}`);
  }
  if (!outboxRules.includes(`expr: ${metricName} == 1`)) {
    throw new Error(`Alert ${alertName} is not wired to ${metricName}`);
  }
  if (!metrics.includes(`"${metricName}"`)) {
    throw new Error(`Alert ${alertName} references an unexported metric: ${metricName}`);
  }
}

const deadLetterBlock = outboxRules.split("- alert: OutboxDeadLetterPresent", 2)[1]?.split("- alert:", 1)[0] ?? "";
if (/^\s*for:/m.test(deadLetterBlock)) {
  throw new Error("Dead-letter alert must fire without a persistence delay.");
}

const claimLostBlock = outboxRules.split("- alert: OutboxClaimLost", 2)[1]?.split("- alert:", 1)[0] ?? "";
if (!claimLostBlock) {
  throw new Error("Missing alert rule: OutboxClaimLost");
}
if (!/^\s*expr: increase\(outbox_claim_lost_total\[5m\]\) > 0$/m.test(claimLostBlock)) {
  throw new Error("OutboxClaimLost must alert on any fenced claim loss within 5m.");
}
if (!/^\s*severity: critical$/m.test(claimLostBlock)) {
  throw new Error("OutboxClaimLost must remain a critical alert.");
}
if (/^\s*for:/m.test(claimLostBlock)) {
  throw new Error("OutboxClaimLost must fire without a persistence delay.");
}
if (!metrics.includes('"outbox_claim_lost_total"')) {
  throw new Error("OutboxClaimLost references an unexported metric: outbox_claim_lost_total");
}

for (const alertName of [
  "OutboxBacklogSloBreached",
  "OutboxFailedMessagesSloBreached",
  "OutboxOldestReadyAgeSloBreached",
]) {
  const block = outboxRules.split(`- alert: ${alertName}`, 2)[1]?.split("- alert:", 1)[0] ?? "";
  if (!/^\s*for: 5m$/m.test(block)) {
    throw new Error(`${alertName} must require a 5m sustained breach.`);
  }
}

const poolWaitersBlock = databaseRules.split("- alert: DatabasePoolWaitersPersistent", 2)[1]?.split("- alert:", 1)[0] ?? "";
if (!poolWaitersBlock) {
  throw new Error("Missing alert rule: DatabasePoolWaitersPersistent");
}
if (!/^\s*expr: database_pool_waiting > 0$/m.test(poolWaitersBlock)) {
  throw new Error("DatabasePoolWaitersPersistent must alert on sustained pool waiters.");
}
if (!/^\s*for: 2m$/m.test(poolWaitersBlock)) {
  throw new Error("DatabasePoolWaitersPersistent must require a 2m sustained breach.");
}
if (!/^\s*severity: warning$/m.test(poolWaitersBlock)) {
  throw new Error("DatabasePoolWaitersPersistent must remain a warning alert.");
}
if (!metrics.includes('"database_pool_waiting"')) {
  throw new Error("DatabasePoolWaitersPersistent references an unexported metric: database_pool_waiting");
}
if (!poolWaitersBlock.includes("docs/PRODUCTION_RUNBOOK.md#postgresql-pool-saturation")) {
  throw new Error("DatabasePoolWaitersPersistent must link to the pool saturation runbook.");
}

const poolUtilizationHighBlock = databaseRules.split("- alert: DatabasePoolUtilizationHigh", 2)[1]?.split("- alert:", 1)[0] ?? "";
if (!poolUtilizationHighBlock) {
  throw new Error("Missing alert rule: DatabasePoolUtilizationHigh");
}
if (!/^\s*expr: database_pool_max > 0 and \(database_pool_active \/ database_pool_max\) >= 0\.8$/m.test(poolUtilizationHighBlock)) {
  throw new Error("DatabasePoolUtilizationHigh must alert at 80% pool utilization.");
}
if (!/^\s*for: 5m$/m.test(poolUtilizationHighBlock) || !/^\s*severity: warning$/m.test(poolUtilizationHighBlock)) {
  throw new Error("DatabasePoolUtilizationHigh must remain a warning after a 5m sustained breach.");
}
if (!poolUtilizationHighBlock.includes("docs/PRODUCTION_RUNBOOK.md#postgresql-pool-saturation")) {
  throw new Error("DatabasePoolUtilizationHigh must link to the pool saturation runbook.");
}

const poolExhaustionBlock = databaseRules.split("- alert: DatabasePoolExhaustionImminent", 2)[1]?.split("- alert:", 1)[0] ?? "";
if (!poolExhaustionBlock) {
  throw new Error("Missing alert rule: DatabasePoolExhaustionImminent");
}
if (!/^\s*expr: database_pool_max > 0 and \(database_pool_active \/ database_pool_max\) >= 0\.95$/m.test(poolExhaustionBlock)) {
  throw new Error("DatabasePoolExhaustionImminent must alert at 95% pool utilization.");
}
if (!/^\s*for: 2m$/m.test(poolExhaustionBlock) || !/^\s*severity: critical$/m.test(poolExhaustionBlock)) {
  throw new Error("DatabasePoolExhaustionImminent must remain critical after a 2m sustained breach.");
}
if (!poolExhaustionBlock.includes("docs/PRODUCTION_RUNBOOK.md#postgresql-pool-saturation")) {
  throw new Error("DatabasePoolExhaustionImminent must link to the pool saturation runbook.");
}
for (const metricName of ["database_pool_active", "database_pool_max"]) {
  if (!metrics.includes(`"${metricName}"`)) {
    throw new Error(`Database pool utilization alerts reference an unexported metric: ${metricName}`);
  }
}
if (!runbook.includes("## PostgreSQL pool saturation")) {
  throw new Error("Missing PostgreSQL pool saturation runbook section.");
}

const tenantAlerts = [
  ["TenantConcurrencySaturationPersistent", "tenant_concurrency_limited_total"],
  ["TenantConcurrencyAcquireFailures", "tenant_concurrency_acquire_failures_total"],
  ["TenantConcurrencyReleaseFailures", "tenant_concurrency_release_failures_total"],
  ["TenantConcurrencyLeaseLost", "tenant_concurrency_lease_lost_total"],
  ["TenantConcurrencyRenewFailures", "tenant_concurrency_renew_failures_total"],
];
for (const [alertName, metricName] of tenantAlerts) {
  const block = tenantConcurrencyRules.split(`- alert: ${alertName}`, 2)[1]?.split("- alert:", 1)[0] ?? "";
  if (!block) throw new Error(`Missing alert rule: ${alertName}`);
  if (!block.includes(metricName)) throw new Error(`${alertName} is not wired to ${metricName}`);
  if (!metrics.includes(`"${metricName}"`)) throw new Error(`${alertName} references an unexported metric: ${metricName}`);
  if (!block.includes("docs/PRODUCTION_RUNBOOK.md#distributed-tenant-concurrency")) {
    throw new Error(`${alertName} must link to the distributed tenant concurrency runbook.`);
  }
}
const tenantSaturationBlock = tenantConcurrencyRules.split("- alert: TenantConcurrencySaturationPersistent", 2)[1]?.split("- alert:", 1)[0] ?? "";
if (!/^\s*for: 5m$/m.test(tenantSaturationBlock)) {
  throw new Error("TenantConcurrencySaturationPersistent must require a 5m sustained breach.");
}
const tenantAcquireFailureBlock = tenantConcurrencyRules.split("- alert: TenantConcurrencyAcquireFailures", 2)[1]?.split("- alert:", 1)[0] ?? "";
if (!/^\s*for: 2m$/m.test(tenantAcquireFailureBlock) || !/^\s*severity: critical$/m.test(tenantAcquireFailureBlock)) {
  throw new Error("TenantConcurrencyAcquireFailures must remain critical after a 2m sustained breach.");
}
const tenantReleaseFailureBlock = tenantConcurrencyRules.split("- alert: TenantConcurrencyReleaseFailures", 2)[1]?.split("- alert:", 1)[0] ?? "";
if (/^\s*for:/m.test(tenantReleaseFailureBlock) || !/^\s*severity: warning$/m.test(tenantReleaseFailureBlock)) {
  throw new Error("TenantConcurrencyReleaseFailures must warn immediately.");
}
const tenantLeaseLostBlock = tenantConcurrencyRules.split("- alert: TenantConcurrencyLeaseLost", 2)[1]?.split("- alert:", 1)[0] ?? "";
if (!/^\s*expr: increase\(tenant_concurrency_lease_lost_total\[5m\]\) > 0$/m.test(tenantLeaseLostBlock)) {
  throw new Error("TenantConcurrencyLeaseLost must alert on any lost lease within 5m.");
}
if (/^\s*for:/m.test(tenantLeaseLostBlock) || !/^\s*severity: critical$/m.test(tenantLeaseLostBlock)) {
  throw new Error("TenantConcurrencyLeaseLost must remain an immediate critical alert.");
}
const tenantRenewFailureBlock = tenantConcurrencyRules.split("- alert: TenantConcurrencyRenewFailures", 2)[1]?.split("- alert:", 1)[0] ?? "";
if (!/^\s*expr: increase\(tenant_concurrency_renew_failures_total\[5m\]\) > 0$/m.test(tenantRenewFailureBlock)) {
  throw new Error("TenantConcurrencyRenewFailures must alert on heartbeat renewal failures within 5m.");
}
if (!/^\s*for: 2m$/m.test(tenantRenewFailureBlock) || !/^\s*severity: critical$/m.test(tenantRenewFailureBlock)) {
  throw new Error("TenantConcurrencyRenewFailures must remain critical after a 2m sustained breach.");
}
if (!runbook.includes("## Distributed tenant concurrency")) {
  throw new Error("Missing distributed tenant concurrency runbook section.");
}

for (const rules of [outboxRules, databaseRules, tenantConcurrencyRules]) {
  for (const forbidden of ["organizationId", "messageId", "payload", "tenantId"]) {
    if (rules.includes(forbidden)) {
      throw new Error(`Alert rules must remain aggregate-only; found ${forbidden}.`);
    }
  }
}

console.log("Prometheus alert rules are consistent with exported aggregate operational metrics and runbooks.");
