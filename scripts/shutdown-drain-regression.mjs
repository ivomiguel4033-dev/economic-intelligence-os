import { readFile } from "node:fs/promises";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [instrumentation, drainState, readiness] = await Promise.all([
  readFile(new URL("../src/instrumentation.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/operations/drain-state.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/ready/route.ts", import.meta.url), "utf8"),
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

console.log("Shutdown drain/readiness regression checks passed");
