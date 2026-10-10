import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/operations/operational-slo.ts", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /Number\.isSafeInteger\(parsed\)/,
  "outbox SLO thresholds must reject integers outside JavaScript's safe range",
);
assert.match(
  source,
  /parsed <= 0/,
  "outbox SLO thresholds must reject zero and negative values",
);
assert.doesNotMatch(
  source,
  /Number\.isInteger\(parsed\)/,
  "outbox SLO thresholds must not accept unsafe integers via Number.isInteger",
);

for (const envName of [
  "OUTBOX_SLO_READY_BACKLOG",
  "OUTBOX_SLO_FAILED_MESSAGES",
  "OUTBOX_SLO_OLDEST_READY_AGE_SECONDS",
]) {
  assert.match(
    source,
    new RegExp(`process\\.env\\.${envName}`),
    `${envName} must remain wired through the validated threshold parser`,
  );
}

const helperMatch = source.match(
  /function positiveInteger\(value: string \| undefined, fallback: number\): number \{[\s\S]*?\n\}/,
);
assert.ok(helperMatch, "positiveInteger helper must remain available for SLO configuration validation");

const executableHelper = helperMatch[0].replace(
  "function positiveInteger(value: string | undefined, fallback: number): number",
  "function positiveInteger(value, fallback)",
);
const positiveInteger = new Function(
  `${executableHelper}; return positiveInteger;`,
)();

assert.equal(positiveInteger("101", 100), 101, "valid positive safe integers must be accepted");
assert.equal(positiveInteger("0", 100), 100, "zero must fall back to the production default");
assert.equal(positiveInteger("-1", 100), 100, "negative values must fall back to the production default");
assert.equal(positiveInteger("1.5", 100), 100, "fractional values must fall back to the production default");
assert.equal(positiveInteger("NaN", 100), 100, "NaN must fall back to the production default");
assert.equal(positiveInteger("Infinity", 100), 100, "Infinity must fall back to the production default");
assert.equal(
  positiveInteger(String(Number.MAX_SAFE_INTEGER), 100),
  Number.MAX_SAFE_INTEGER,
  "the largest safe integer must remain valid",
);
assert.equal(
  positiveInteger(String(Number.MAX_SAFE_INTEGER + 1), 100),
  100,
  "integers above Number.MAX_SAFE_INTEGER must fall back to the production default",
);

const runtimeThresholdHelperMatch = source.match(
  /function assertPositiveThreshold\(value: number, name: string\): void \{[\s\S]*?\n\}/,
);
assert.ok(
  runtimeThresholdHelperMatch,
  "runtime outbox SLO thresholds must remain guarded by assertPositiveThreshold",
);

const executableRuntimeThresholdHelper = runtimeThresholdHelperMatch[0]
  .replace("function assertPositiveThreshold(value: number, name: string): void", "function assertPositiveThreshold(value, name)");
const assertPositiveThreshold = new Function(
  `${executableRuntimeThresholdHelper}; return assertPositiveThreshold;`,
)();

for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(
    () => assertPositiveThreshold(value, "threshold"),
    /threshold must be a positive safe integer/,
    `runtime threshold ${String(value)} must fail closed`,
  );
}
assert.doesNotThrow(
  () => assertPositiveThreshold(1, "threshold"),
  "the smallest positive safe integer must remain valid at runtime",
);
assert.doesNotThrow(
  () => assertPositiveThreshold(Number.MAX_SAFE_INTEGER, "threshold"),
  "the largest positive safe integer must remain valid at runtime",
);

for (const thresholdName of [
  "readyBacklog",
  "failedMessages",
  "oldestReadyAgeSeconds",
]) {
  assert.match(
    source,
    new RegExp(`assertPositiveThreshold\\(thresholds\\.${thresholdName},`),
    `thresholds.${thresholdName} must be validated before SLO evaluation`,
  );
}

console.log("Operational SLO regression checks passed");
