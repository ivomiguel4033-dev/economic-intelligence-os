import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/operations/circuit-breaker.ts", import.meta.url), "utf8");

assert.match(source, /Number\.isSafeInteger\(value\)/, "circuit breaker thresholds must reject non-safe integers");
assert.match(source, /value <= 0/, "circuit breaker thresholds must reject zero and negative values");
assert.match(source, /assertPositiveSafeInteger\(failureThreshold, ["']failureThreshold["']\)/, "failure threshold must be validated at construction");
assert.match(source, /assertPositiveSafeInteger\(resetAfterMs, ["']resetAfterMs["']\)/, "reset interval must be validated at construction");

const finiteChecks = source.match(/Number\.isFinite\(now\)/g) ?? [];
assert.equal(finiteChecks.length, 2, "both canExecute and failure must reject non-finite runtime timestamps");
assert.match(source, /if \(this\.state\.openedAt === undefined\) return true;/, "openedAt=0 must remain a valid open-circuit timestamp");
assert.doesNotMatch(source, /if \(!this\.state\.openedAt\)/, "circuit state must not use truthiness for openedAt");
assert.match(source, /now - this\.state\.openedAt >= this\.resetAfterMs/, "half-open reset must be based on elapsed time");
assert.match(source, /this\.state = \{ failures: 0 \};/, "successful reset must clear breaker state");

console.log("Circuit breaker regression checks passed");
