import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../src/app/api/orchestrate/route.ts", import.meta.url), "utf8");

const snapshotIndex = route.indexOf("getDatabasePoolSnapshot()");
const saturationIndex = route.indexOf("pool.total >= pool.max && pool.idle === 0");
const reasonIndex = route.indexOf('reason: "database_pool_saturated"');
const retryAfterIndex = route.indexOf('"Retry-After": "1"');
const noStoreIndex = route.indexOf('"Cache-Control": "no-store"');
const parseIndex = route.indexOf("await request.json()");
const authIndex = route.indexOf("await resolveAuthenticatedContext(");
const billingIndex = route.indexOf("await enforceRuntimeBilling(");

assert.ok(snapshotIndex >= 0, "orchestrate must inspect the PostgreSQL pool before accepting work");
assert.ok(saturationIndex > snapshotIndex, "orchestrate must detect a fully saturated pool");
assert.ok(reasonIndex > saturationIndex, "load shedding must expose a stable machine-readable reason");
assert.ok(retryAfterIndex > saturationIndex, "load shedding must tell callers when to retry");
assert.ok(noStoreIndex > saturationIndex, "overload responses must not be cached");
assert.ok(parseIndex > saturationIndex, "load shedding must happen before parsing request bodies");
assert.ok(authIndex > saturationIndex, "load shedding must happen before authentication performs database work");
assert.ok(billingIndex > saturationIndex, "load shedding must happen before billing performs database work");

const overloadBlock = route.slice(saturationIndex, parseIndex);
assert.match(overloadBlock, /status:\s*503/, "saturated orchestration traffic must fail with HTTP 503");

console.log("orchestrate load-shedding regression checks passed");
