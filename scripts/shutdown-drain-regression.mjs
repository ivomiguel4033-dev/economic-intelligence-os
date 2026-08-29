import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [instrumentation, drainState, readiness, decisionsRoute, orchestrateRoute, deploymentSafety, transactionalOutbox] = await Promise.all([
  readFile(new URL("../src/instrumentation.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/operations/drain-state.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/ready/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/decisions/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/orchestrate/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/operations/deployment-safety.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/execution/transactional-outbox.ts", import.meta.url), "utf8"),
]);

assert(
  /process\.on\(["']SIGTERM["'],\s*enterDrain\)/.test(instrumentation),
  "SIGTERM must enter drain state before shutdown",
);
assert(
  /process\.on\(["']SIGINT["'],\s*enterDrain\)/.test(instrumentation),
  "SIGINT must enter drain state before shutdown",
);
assert(
  /const enterDrain\s*=\s*\(\)\s*:\s*void\s*=>\s*\{[\s\S]*?beginDrain\(\);[\s\S]*?\}/.test(instrumentation),
  "Shutdown signal handler must call beginDrain",
);
assert(
  /export function beginDrain\(\): void\s*\{\s*draining = true;\s*\}/.test(drainState),
  "beginDrain must transition process-local admission state to draining",
);
assert(
  /export function tryBeginTrackedWork\(\): \(\(\) => void\) \| null\s*\{\s*if \(draining\) return null;[\s\S]*?inFlightWork \+= 1;/.test(drainState),
  "Tracked work admission must reject draining instances before incrementing in-flight work",
);
assert(
  /if \(released\) return;\s*released = true;\s*inFlightWork -= 1;/.test(drainState),
  "Tracked work release must be idempotent and decrement exactly once",
);
assert(
  /export function getInFlightWorkCount\(\): number\s*\{\s*return inFlightWork;\s*\}/.test(drainState),
  "Drain state must expose the current in-flight work count",
);

for (const [name, route] of [["decisions", decisionsRoute], ["orchestrate", orchestrateRoute]]) {
  const admissionIndex = route.indexOf("const releaseWork = tryBeginTrackedWork()");
  const authIndex = route.indexOf("resolveAuthenticatedContext(");
  assert(admissionIndex >= 0, `${name} route must atomically admit tracked work`);
  assert(authIndex >= 0, `${name} route authentication boundary missing`);
  assert(admissionIndex < authIndex, `${name} route must reject draining before authentication or downstream work`);
  assert(
    /finally\s*\{\s*releaseWork\(\);\s*\}/.test(route),
    `${name} route must release tracked work in a finally block`,
  );
}

const drainCheckIndex = readiness.indexOf("if (isDraining())");
const databaseProbeIndex = readiness.indexOf("await db.query(");
assert(drainCheckIndex >= 0, "Readiness must check drain state");
assert(databaseProbeIndex >= 0, "Readiness database probe missing");
assert(
  drainCheckIndex < databaseProbeIndex,
  "Readiness must fail closed on draining before touching PostgreSQL",
);

const drainingBranch = readiness.slice(drainCheckIndex, databaseProbeIndex);
assert(/status:\s*["']not_ready["']/.test(drainingBranch), "Draining readiness must report not_ready");
assert(/reason:\s*["']draining["']/.test(drainingBranch), "Draining readiness must expose the draining reason");
assert(/status:\s*503/.test(drainingBranch), "Draining readiness must return HTTP 503");
assert(/Retry-After["']?:\s*["']1["']/.test(drainingBranch), "Draining readiness must advertise retry timing");

assert(
  /WHERE status='processing' AND claimed_by=\$1/.test(transactionalOutbox),
  "Drain safety must count only durable processing claims owned by the current worker",
);
assert(
  /export async function evaluateWorkerDrainSafety\(workerId: string\)[\s\S]*?getClaimedOutboxCount\(workerId\)[\s\S]*?evaluateLocalDrainSafety\(claimedOutboxMessages\)/.test(deploymentSafety),
  "Worker drain safety must combine durable owned outbox claims with process-local admission state",
);
assert(
  /acceptingNewWork:\s*!isDraining\(\)[\s\S]*?inFlightExecutions:\s*getInFlightWorkCount\(\)[\s\S]*?claimedOutboxMessages/.test(deploymentSafety),
  "Termination safety must require draining, zero in-flight work, and zero owned outbox claims",
);
assert(
  /if \(signals\.acceptingNewWork\) blockers\.push\(["']Service is still accepting new work["']\)/.test(deploymentSafety),
  "A non-draining instance must never be declared safe to terminate",
);
assert(
  /signals\.inFlightExecutions > 0[\s\S]*?Executions are still in flight/.test(deploymentSafety),
  "In-flight executions must block termination",
);
assert(
  /signals\.claimedOutboxMessages > 0[\s\S]*?Outbox messages are still claimed/.test(deploymentSafety),
  "Owned outbox claims must block termination",
);

console.log("Shutdown drain/readiness regression checks passed");
