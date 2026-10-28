import fs from "node:fs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
  /res\.complete&&bytes>0&&bytes<=65536&&res\.statusCode===200&&/,
  "Docker liveness healthcheck must require exactly HTTP 200",
);
assert.ok(
  dockerfile.includes("(res.headers['content-type']||'').split(';')[0].trim().toLowerCase()==='application/json'?0:1"),
  "Docker liveness healthcheck must reject HTTP 200 non-JSON responses",
);


 // Exercise the actual Docker HEALTHCHECK command, not a reimplementation.
 // A 200 header followed by a truncated response must never mark a container healthy.
 const healthcheckLine = dockerfile.split("\n").find((line) => line.startsWith("HEALTHCHECK "));
 assert.ok(healthcheckLine, "Docker liveness healthcheck must be configured");
 const healthcheckCommand = /\bCMD (\["node", "-e", .+\])$/.exec(healthcheckLine);
 assert.ok(healthcheckCommand, "Docker healthcheck must execute a Node inline probe");
 const [binary, flag, probeScript] = JSON.parse(healthcheckCommand[1]);
 assert.deepEqual([binary, flag], ["node", "-e"], "Docker healthcheck must use node -e");
 let responseMode = "complete";
 const probeServer = createServer((request, response) => {
   assert.equal(request.url, "/api/health", "Docker healthcheck must target liveness");
   const contentType = responseMode === "html" ? "text/html" : "application/json; charset=utf-8";
   if (responseMode === "truncated") {
     response.writeHead(200, { "Content-Length": "100", "Content-Type": contentType });
     response.flushHeaders();
     response.write("partial");
     setTimeout(() => response.socket?.destroy(), 50);
     return;
   }
   if (responseMode === "boundary" || responseMode === "oversized") {
     const size = responseMode === "boundary" ? 65536 : 65537;
     response.writeHead(200, { "Content-Length": String(size), "Content-Type": contentType });
     response.end("x".repeat(size));
     return;
   }
   const noContent = responseMode === "no-content";
   const empty = responseMode === "empty";
   const headers = { "Content-Length": noContent || empty ? "0" : "2" };
   if (responseMode !== "missing-type") headers["Content-Type"] = contentType;
   response.writeHead(noContent ? 204 : 200, headers);
   response.end(noContent || empty ? undefined : "ok");
 });
 await new Promise((resolve) => probeServer.listen(0, "127.0.0.1", resolve));
 const exec = promisify(execFile);
 async function runHealthcheck() {
   try {
     await exec(process.execPath, ["-e", probeScript], {
       env: { ...process.env, PORT: String(probeServer.address().port) },
       timeout: 6500,
     });
     return true;
   } catch (error) {
     // A harness timeout, signal or missing runtime is not a valid negative test.
     if (error.killed || error.signal || typeof error.code !== "number") throw error;
     return false;
   }
 }
 try {
   for (const [mode, expected] of [
     ["complete", true],
     ["boundary", true],
     ["oversized", false],
     ["empty", false],
     ["no-content", false],
     ["html", false],
     ["missing-type", false],
     ["truncated", false],
   ]) {
     responseMode = mode;
     assert.equal(await runHealthcheck(), expected,
       `Docker healthcheck must ${expected ? "accept" : "reject"} ${mode} response`);
   }
 } finally {
   await new Promise((resolve) => probeServer.close(resolve));
 }

console.log("Railway deployment configuration regression checks passed.");
