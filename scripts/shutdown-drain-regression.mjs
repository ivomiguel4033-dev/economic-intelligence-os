import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [instrumentation, drainState, readiness, decisionsRoute, orchestrateRoute, deploymentSafety, transactionalOutbox, outboxDispatcher] = await Promise.all([
  readFile(new URL("../src/instrumentation.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/operations/drain-state.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/ready/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/decisions/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/orchestrate/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/operations/deployment-safety.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/execution/transactional-outbox.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/execution/outbox-dispatcher.ts", import.meta.url), "utf8"),
]);

assert(
  /process\.on\(["']SIGTERM["'],\s*\(\)\s*=>\s*enterDrain\(["']SIGTERM["']\)\)/.test(instrumentation),
  "SIGTERM must enter drain state with an explicit signal identity",
);
assert(
  /process\.on\(["']SIGINT["'],\s*\(\)\s*=>\s*enterDrain\(["']SIGINT["']\)\)/.test(instrumentation),
  "SIGINT must enter drain state with an explicit signal identity",
);
assert(
  /const enterDrain\s*=\s*\(signal:\s*NodeJS\.Signals\)\s*:\s*void\s*=>\s*\{[\s\S]*?beginDrain\(\);[\s\S]*?\}/.test(instrumentation),
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
    /finally\s*\{[\s\S]*?releaseWork\(\);\s*\}/.test(route),
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
assert(/if \(isDraining\(\)\) return notReady\(["']draining["']\)/.test(drainingBranch), "Draining readiness must use the fail-closed not-ready response");
assert(
  /function notReady\(reason: string\)[\s\S]*?status:\s*["']not_ready["'][\s\S]*?reason,[\s\S]*?status:\s*503[\s\S]*?Retry-After["']?:\s*["']1["']/.test(readiness),
  "Shared readiness failure response must report not_ready, preserve the reason, return HTTP 503 and advertise retry timing",
);

assert(
  /WHERE status='processing' AND claimed_by=\$1/.test(transactionalOutbox),
  "Drain safety must count only durable processing claims owned by the current worker",
);
assert(
  /export async function evaluateWorkerDrainSafety\(workerId: string\)[\s\S]*?requireDrainWorkerId\(workerId\)[\s\S]*?getClaimedOutboxCount\(normalizedWorkerId\)[\s\S]*?evaluateLocalDrainSafety\(claimedOutboxMessages\)/.test(deploymentSafety),
  "Worker drain safety must normalize identity, query durable owned outbox claims, and combine them with process-local admission state",
);
assert(
  /function requireDrainWorkerId\(workerId: string\): string\s*\{[\s\S]*?workerId\.trim\(\)[\s\S]*?if \(!normalizedWorkerId\) throw new Error\(["']Drain workerId is required["']\)[\s\S]*?return normalizedWorkerId/.test(deploymentSafety),
  "Drain worker identity must be normalized and empty identities rejected before durable ownership lookup",
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

assert(
  /function boundedDrainOption\([\s\S]*?Number\.isFinite\(value\)[\s\S]*?Math\.max\(min, Math\.min\(value, max\)\)/.test(deploymentSafety),
  "Drain coordinator must reject non-finite timing options and enforce explicit bounds",
);
assert(
  /const timeoutMs = boundedDrainOption\(options\.timeoutMs, 25_000, 0, 25_000\)/.test(deploymentSafety),
  "Drain coordinator must cap its wait below the platform hard termination window",
);
assert(
  /const pollIntervalMs = boundedDrainOption\(options\.pollIntervalMs, 250, 25, 1_000\)/.test(deploymentSafety),
  "Drain coordinator must bound polling to a safe interval",
);
assert(
  /import \{ performance \} from ["']node:perf_hooks["']/.test(deploymentSafety) &&
    /const startedAt = performance\.now\(\)/.test(deploymentSafety) &&
    /const elapsedMs = performance\.now\(\) - startedAt/.test(deploymentSafety),
  "Drain deadline must use a monotonic clock so wall-clock adjustments cannot corrupt shutdown timing",
);
assert(
  /catch\s*\{[\s\S]*?safeToTerminate:\s*false,[\s\S]*?Drain safety evaluation failed/.test(deploymentSafety),
  "Drain coordinator evaluation errors must fail closed",
);
assert(
  /elapsedMs >= timeoutMs[\s\S]*?safeToTerminate:\s*false,[\s\S]*?timedOut:\s*true/.test(deploymentSafety),
  "Drain coordinator timeout must never report safe termination",
);
assert(
  /if \(lastDecision\.safeToTerminate\)\s*\{[\s\S]*?timedOut:\s*false/.test(deploymentSafety),
  "Drain coordinator may complete early only after an explicit safe decision",
);

assert(
  /import \{ resolveOutboxWorkerId \} from ["']\.\/execution\/outbox-dispatcher["']/.test(instrumentation),
  "Shutdown must use the shared outbox worker identity resolver",
);
assert(
  /const workerId = resolveOutboxWorkerId\(\)/.test(instrumentation),
  "Shutdown must resolve worker identity through the shared resolver",
);
assert(
  /export function resolveOutboxWorkerId\(env: NodeJS\.ProcessEnv = process\.env\): string \| undefined\s*\{\s*const configured = env\.OUTBOX_WORKER_ID\?\.trim\(\);\s*return configured \|\| undefined;\s*\}/.test(outboxDispatcher),
  "Worker identity resolver must trim configured IDs and reject empty configuration",
);
assert(
  /export function requireOutboxWorkerId\(env: NodeJS\.ProcessEnv = process\.env\): string\s*\{[\s\S]*?resolveOutboxWorkerId\(env\)[\s\S]*?if \(!workerId\) throw new Error\(["']OUTBOX_WORKER_ID is required["']\)/.test(outboxDispatcher),
  "Production worker identity requirement must fail closed when OUTBOX_WORKER_ID is absent",
);
assert(
  /if \(process\.env\.NODE_ENV === ["']production["']\) requireOutboxWorkerId\(\)/.test(outboxDispatcher),
  "Dispatcher must enforce configured worker identity in production",
);
assert(
  /const normalizedWorkerId = workerId\.trim\(\);\s*if \(!normalizedWorkerId\) throw new Error\(["']OutboxDispatcher requires workerId["']\)/.test(outboxDispatcher),
  "Dispatcher must reject empty or whitespace-only worker IDs",
);
assert(
  /const configuredWorkerId = resolveOutboxWorkerId\(\);[\s\S]*?configuredWorkerId !== normalizedWorkerId[\s\S]*?throw new Error\(["']OutboxDispatcher workerId does not match OUTBOX_WORKER_ID["']\)/.test(outboxDispatcher),
  "Dispatcher must fail closed when constructor and configured worker identities diverge",
);
assert(
  /this\.workerId = normalizedWorkerId/.test(outboxDispatcher),
  "Dispatcher must use the normalized worker identity for durable claims",
);

console.log("Shutdown drain/readiness regression checks passed");
