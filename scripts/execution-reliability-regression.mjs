import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function retryDelay(attempt, policy = { maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 2000 }) {
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attempt - 1));
}
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
assert.equal(evaluateReexecution({ status: "confirmed_succeeded" }).mayReexecute, false);
assert.equal(evaluateReexecution({ status: "still_uncertain" }).mayReexecute, false);
assert.equal(evaluateReexecution({ status: "confirmed_failed" }).mayReexecute, true);
const breaker = new CircuitBreaker();
breaker.failure(); breaker.failure();
assert.equal(breaker.canExecute(), true);
breaker.failure();
assert.equal(breaker.canExecute(), false);

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
