import fs from "node:fs";
import assert from "node:assert/strict";

const railway = JSON.parse(fs.readFileSync("railway.json", "utf8"));
const dockerfile = fs.readFileSync("Dockerfile", "utf8");

assert.equal(
  railway.build?.builder,
  "DOCKERFILE",
  "Railway must use the hardened Dockerfile build path",
);
assert.equal(
  railway.build?.dockerfilePath,
  "Dockerfile",
  "Railway Dockerfile path must remain explicit",
);

assert.equal(
  railway.deploy?.preDeployCommand,
  "node scripts/production-preflight.mjs && npm run migrate",
  "Production preflight and database migrations must run before a production deploy becomes active",
);
assert.equal(
  railway.deploy?.startCommand,
  "node node_modules/next/dist/bin/next start",
  "Railway start command must match the production image runtime",
);
assert.equal(
  railway.deploy?.healthcheckPath,
  "/api/ready",
  "Railway health checks must use database-aware readiness",
);
assert.ok(
  Number.isInteger(railway.deploy?.healthcheckTimeout) &&
    railway.deploy.healthcheckTimeout >= 60 &&
    railway.deploy.healthcheckTimeout <= 300,
  "Railway healthcheck timeout must be a bounded 60-300 seconds",
);

// Railway stores drainingSeconds as a decimal string. parseInt() would silently
// accept malformed values such as "30s" or "30.5", hiding config drift in CI.
function parseDrainSeconds(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 25 && seconds <= 60 ? seconds : null;
}

assert.notEqual(
  parseDrainSeconds(railway.deploy?.drainingSeconds),
  null,
  "Railway draining window must be an exact decimal string between 25 and 60 seconds",
);
for (const [value, expected] of [["25", 25], ["30", 30], ["60", 60]]) {
  assert.equal(parseDrainSeconds(value), expected, "Valid draining window must be accepted");
}
for (const invalid of ["24", "61", "30s", "30.5", "30e0", " 30", "30 ", "030", "-30", 30, null]) {
  assert.equal(parseDrainSeconds(invalid), null, "Invalid draining window must fail closed: " + String(invalid));
}

assert.equal(
  railway.deploy?.restartPolicyType,
  "ON_FAILURE",
  "Railway restart policy must remain failure-scoped",
);
assert.ok(
  Number.isInteger(railway.deploy?.restartPolicyMaxRetries) &&
    railway.deploy.restartPolicyMaxRetries >= 1 &&
    railway.deploy.restartPolicyMaxRetries <= 10,
  "Railway restart retries must remain bounded",
);

assert.match(
  dockerfile,
  /RUN mkdir -p public/,
  "Builder must materialize an empty public directory so the production COPY remains valid before static assets exist",
);
assert.match(
  dockerfile,
  /COPY --chown=node:node --from=builder \/app\/scripts \.\/scripts/,
  "Production image migration runner must be present for Railway pre-deploy",
);
assert.match(
  dockerfile,
  /COPY --chown=node:node --from=builder \/app\/db \.\/db/,
  "Production image database migrations must be present for Railway pre-deploy",
);
assert.match(
  dockerfile,
  /USER node/,
  "Production image must run as a non-root user",
);
assert.match(
  dockerfile,
  /CMD \["node", "node_modules\/next\/dist\/bin\/next", "start"\]/,
  "Docker image command must match Railway production startup",
);

// Container liveness must not report 204/206 or other 2xx responses as healthy.
// Railway separately gates traffic on /api/ready; Docker's probe is liveness only.
assert.match(
  dockerfile,
  /res\.statusCode===200\?0:1/,
  "Docker liveness healthcheck must require exactly HTTP 200",
);

console.log("Railway deployment configuration regression checks passed.");
