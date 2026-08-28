import fs from "node:fs";

const rulesPath = "ops/prometheus/outbox-alerts.yml";
const metricsPath = "src/observability/service-metrics.ts";

const rules = fs.readFileSync(rulesPath, "utf8");
const metrics = fs.readFileSync(metricsPath, "utf8");

const requiredAlerts = [
  ["OutboxDeadLetterPresent", "outbox_slo_dead_letter_breached"],
  ["OutboxBacklogSloBreached", "outbox_slo_backlog_breached"],
  ["OutboxFailedMessagesSloBreached", "outbox_slo_failed_breached"],
  ["OutboxOldestReadyAgeSloBreached", "outbox_slo_oldest_ready_age_breached"],
];

for (const [alertName, metricName] of requiredAlerts) {
  if (!rules.includes(`alert: ${alertName}`)) {
    throw new Error(`Missing alert rule: ${alertName}`);
  }
  if (!rules.includes(`expr: ${metricName} == 1`)) {
    throw new Error(`Alert ${alertName} is not wired to ${metricName}`);
  }
  if (!metrics.includes(`"${metricName}"`)) {
    throw new Error(`Alert ${alertName} references an unexported metric: ${metricName}`);
  }
}

const deadLetterBlock = rules.split("- alert: OutboxDeadLetterPresent", 2)[1]?.split("- alert:", 1)[0] ?? "";
if (/^\s*for:/m.test(deadLetterBlock)) {
  throw new Error("Dead-letter alert must fire without a persistence delay.");
}

for (const alertName of [
  "OutboxBacklogSloBreached",
  "OutboxFailedMessagesSloBreached",
  "OutboxOldestReadyAgeSloBreached",
]) {
  const block = rules.split(`- alert: ${alertName}`, 2)[1]?.split("- alert:", 1)[0] ?? "";
  if (!/^\s*for: 5m$/m.test(block)) {
    throw new Error(`${alertName} must require a 5m sustained breach.`);
  }
}

for (const forbidden of ["organizationId", "messageId", "payload", "tenantId"]) {
  if (rules.includes(forbidden)) {
    throw new Error(`Alert rules must remain aggregate-only; found ${forbidden}.`);
  }
}

console.log("Prometheus outbox alert rules are consistent with exported SLO metrics.");
