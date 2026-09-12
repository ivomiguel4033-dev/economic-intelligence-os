import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { executionIdempotencyKey } from "../src/execution/idempotency.ts";
import { isRetryableStatus, retryDelay } from "../src/execution/retry-policy.ts";

function evaluateReexecution(result) {
  if (result.status === "confirmed_succeeded") return { mayReexecute: false };
  if (result.status === "still_uncertain") return { mayReexecute: false };
  return { mayReexecute: true };
}
class CircuitBreaker {
  constructor(threshold = 3) { this.threshold = threshold; this.failures = 0; this.open = false; }
  failure() { this.failures += 1; if (this.failures >= this.threshold) this.open = true; }
  canExecute() { return !this.open; }
}

assert.equal(retryDelay(1), 250);
assert.equal(retryDelay(2), 500);
assert.equal(retryDelay(10), 2000);
assert.equal(retryDelay(Number.MAX_SAFE_INTEGER), 2000, "very large attempts must cap without overflow");
for (const invalidAttempt of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => retryDelay(invalidAttempt), /Invalid retry policy attempt/);
}
for (const invalidPolicy of [
  { maxAttempts: 0, baseDelayMs: 250, maxDelayMs: 2000 },
  { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 2000 },
  { maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 0 },
  { maxAttempts: 3.5, baseDelayMs: 250, maxDelayMs: 2000 },
  { maxAttempts: 3, baseDelayMs: 2001, maxDelayMs: 2000 },
]) {
  assert.throws(() => retryDelay(1, invalidPolicy), /Invalid retry policy/);
}
for (const status of [408, 429, 500, 503, 599]) assert.equal(isRetryableStatus(status), true);
for (const status of [99, 200, 400, 499, 600, 500.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.equal(isRetryableStatus(status), false);
}
assert.equal(evaluateReexecution({ status: "confirmed_succeeded" }).mayReexecute, false);
assert.equal(evaluateReexecution({ status: "still_uncertain" }).mayReexecute, false);
assert.equal(evaluateReexecution({ status: "confirmed_failed" }).mayReexecute, true);
const breaker = new CircuitBreaker();
breaker.failure(); breaker.failure();
assert.equal(breaker.canExecute(), true);
breaker.failure();
assert.equal(breaker.canExecute(), false);

const validIdempotencyKey = executionIdempotencyKey({ organizationId: "org-a", actionId: "action-1", actionType: "decision.execute" });
assert.match(validIdempotencyKey, /^[a-f0-9]{64}$/);
assert.equal(
  executionIdempotencyKey({ organizationId: "org-a", actionId: "action-1", actionType: "decision.execute" }),
  validIdempotencyKey,
  "identical execution identity must derive the same idempotency key",
);
assert.notEqual(
  executionIdempotencyKey({ organizationId: "org-b", actionId: "action-1", actionType: "decision.execute" }),
  validIdempotencyKey,
  "organization identity must be part of the idempotency key",
);

for (const invalidValue of ["", " value", "value ", "value:other", "value\nother", "value\tother", 42, null]) {
  for (const field of ["organizationId", "actionId", "actionType"]) {
    const input = { organizationId: "org-a", actionId: "action-1", actionType: "decision.execute", [field]: invalidValue };
    assert.throws(() => executionIdempotencyKey(input), /Invalid idempotency/);
  }
}
assert.throws(
  () => executionIdempotencyKey({ organizationId: "o".repeat(257), actionId: "action-1", actionType: "decision.execute" }),
  /Invalid idempotency organizationId/,
);

const leaseSource = readFileSync(new URL("../src/execution/execution-lease.ts", import.meta.url), "utf8");
assert.match(leaseSource, /async renew\(leaseKey: string, ttlSeconds = 60, fencingToken\?: string\)/);
assert.match(leaseSource, /UPDATE execution_leases SET expires_at=[\s\S]*organization_id=\$1[\s\S]*owner_id=\$3[\s\S]*expires_at > NOW\(\)[\s\S]*fencing_token=\$5::bigint/);
assert.match(leaseSource, /async release\(leaseKey: string, fencingToken\?: string\)/);
assert.match(leaseSource, /DELETE FROM execution_leases[\s\S]*organization_id=\$1[\s\S]*owner_id=\$3[\s\S]*fencing_token=\$4::bigint/);

const resilientSource = readFileSync(new URL("../src/execution/resilient-execution.ts", import.meta.url), "utf8");
assert.match(resilientSource, /lease\.renew\(leaseKey, leaseTtlSeconds, fence\.fencingToken\)/);
assert.match(resilientSource, /lease\.release\(leaseKey, fence\.fencingToken\)/);

const idempotencySource = readFileSync(new URL("../src/execution/postgres-idempotency-store.ts", import.meta.url), "utf8");
assert.match(idempotencySource, /SELECT action_id, result FROM execution_idempotency[\s\S]*idempotency_key=\$1 AND organization_id=\$2/);
assert.match(idempotencySource, /if \(row\.action_id !== this\.actionId\)[\s\S]*throw new Error\("Idempotency key collision detected for a different action"\)/);
assert.match(idempotencySource, /ON CONFLICT \(organization_id, idempotency_key\) DO NOTHING/);
assert.match(idempotencySource, /SELECT action_id, result = \$4::jsonb AS same_result[\s\S]*idempotency_key=\$1 AND organization_id=\$2/);
assert.match(idempotencySource, /if \(!row\) throw new Error\("Idempotency conflict detected without an existing record"\)/);
assert.match(idempotencySource, /row\.action_id !== this\.actionId \|\| row\.same_result !== true/);
assert.match(idempotencySource, /throw new Error\("Idempotency key collision detected for a different action or result"\)/);
assert.match(idempotencySource, /return false;/);

const outboxSource = readFileSync(new URL("../src/execution/transactional-outbox.ts", import.meta.url), "utf8");
assert.match(outboxSource, /function boundedInteger\([\s\S]*Number\.isFinite\(value\)[\s\S]*Math\.trunc\(value\)/);
assert.match(outboxSource, /boundedInteger\(maxProcessingSeconds, 300, 30, 86400\)/);
assert.match(outboxSource, /boundedInteger\(retryAfterSeconds, 5, 1, 3600\)/);
assert.match(outboxSource, /boundedInteger\(maxAttempts, 5, 1, 100\)/);
assert.match(outboxSource, /boundedInteger\(limit, 25, 1, 100\)/);
assert.match(outboxSource, /boundedInteger\(input\.retryAfterSeconds, 30, 1, 3600\)/);
assert.match(outboxSource, /boundedInteger\(input\.maxAttempts, 5, 1, 100\)/);
assert.match(outboxSource, /export async function renewOutboxClaim\([\s\S]*claimed_at=NOW\(\)[\s\S]*organization_id=\$2[\s\S]*claimed_by=\$3[\s\S]*claim_token=\$4::bigint/);
assert.match(outboxSource, /export class OutboxClaimOwnershipError extends Error/);
assert.match(outboxSource, /markOutboxDelivered\([\s\S]*throw new OutboxClaimOwnershipError/);
assert.match(outboxSource, /markOutboxFailed\([\s\S]*throw new OutboxClaimOwnershipError/);

const dispatcherSource = readFileSync(new URL("../src/execution/outbox-dispatcher.ts", import.meta.url), "utf8");
assert.match(dispatcherSource, /renewOutboxClaim/);
assert.match(dispatcherSource, /claimHeartbeatMs\(\)[\s\S]*staleClaimSeconds[\s\S]*\/ 3/);
assert.match(dispatcherSource, /setInterval\([\s\S]*renewOutboxClaim/);
assert.match(dispatcherSource, /OutboxClaimLostError/);
assert.match(dispatcherSource, /OutboxClaimOwnershipError/);
assert.match(dispatcherSource, /recordClaimLost\(message\)/);
assert.match(dispatcherSource, /error instanceof OutboxClaimLostError \|\| error instanceof OutboxClaimOwnershipError/);
assert.match(dispatcherSource, /catch \(ackError\)[\s\S]*ackError instanceof OutboxClaimOwnershipError[\s\S]*recordClaimLost\(message\)[\s\S]*throw ackError/);
assert.match(dispatcherSource, /outbox_claim_lost_total/);

console.log("Execution reliability regression checks passed.");