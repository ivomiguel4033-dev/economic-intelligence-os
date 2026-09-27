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
  "npm run migrate",
  "Database migrations must run before a production deploy becomes active",
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

const drainingSeconds = Number.parseInt(railway.deploy?.drainingSeconds ?? "", 10);
assert.ok(
  Number.isInteger(drainingSeconds) && drainingSeconds >= 25 && drainingSeconds <= 60,
  "Railway draining window must preserve the application's bounded shutdown drain",
);

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
  /USER node/,
  "Production image must run as a non-root user",
);
assert.match(
  dockerfile,
  /CMD \["node", "node_modules\/next\/dist\/bin\/next", "start"\]/,
  "Docker image command must match Railway production startup",
);

console.log("Railway deployment configuration regression checks passed.");
