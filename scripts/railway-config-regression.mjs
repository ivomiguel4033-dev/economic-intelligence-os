import fs from "node:fs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const railway = JSON.parse(fs.readFileSync("railway.json", "utf8"));
const dockerfile = fs.readFileSync("Dockerfile", "utf8");

// Reject unexpected top-level/build options as well as deploy options. These
// can redirect builds to another source or silently change release behavior.
assert.ok(railway && typeof railway === "object" && !Array.isArray(railway),
  "Railway configuration must be an object");
for (const key of Object.keys(railway)) {
  assert.ok(new Set(["$schema", "build", "deploy"]).has(key),
    "Unreviewed Railway top-level setting: " + key);
}
// Railway config is committed to Git: credentials must only come from the
// Railway environment, never from an inline variables/secrets configuration.
function assertNoInlineCredentials(value, location = "railway") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    assert.ok(!/(?:secret|token|password|api[_-]?key|credential|private[_-]?key)/i.test(key),
      "Potential inline credential in Railway configuration at " + location + "." + key);
    assertNoInlineCredentials(nested, location + "." + key);
  }
}
assertNoInlineCredentials(railway);
for (const unsafe of [
  { build: { apiKey: "test-only" } },
  { deploy: { nested: { password: "test-only" } } },
]) {
  assert.throws(() => assertNoInlineCredentials(unsafe), /Potential inline credential/,
    "Inline credential regression must fail closed");
}

assert.equal(
  railway.$schema,
  "https://railway.com/railway.schema.json",
  "Railway schema must remain pinned to the reviewed official schema URL",
);
assert.ok(railway.build && typeof railway.build === "object" && !Array.isArray(railway.build),
  "Railway build configuration must be an object");
for (const key of Object.keys(railway.build)) {
  assert.ok(new Set(["builder", "dockerfilePath"]).has(key),
    "Unreviewed Railway build setting: " + key);
}

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

// Fail closed if a future config introduces an unreviewed deployment behavior.
// In particular, cron scheduling or an alternate healthcheck/start path must
// never silently bypass the reviewed web-only release procedure.
const allowedDeployKeys = new Set([
  "preDeployCommand", "startCommand", "healthcheckPath",
  "healthcheckTimeout", "drainingSeconds", "restartPolicyType",
  "restartPolicyMaxRetries",
]);
assert.ok(
  railway.deploy && typeof railway.deploy === "object" && !Array.isArray(railway.deploy),
  "Railway deploy configuration must be an object",
);
for (const key of Object.keys(railway.deploy)) {
  assert.ok(allowedDeployKeys.has(key), "Unreviewed Railway deploy setting: " + key);
}

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
// Require at least 30s to match the production image StopTimeout contract and
// prevent Railway from terminating in-flight requests before the drain window.
function parseDrainSeconds(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 30 && seconds <= 60 ? seconds : null;
}

assert.notEqual(
  parseDrainSeconds(railway.deploy?.drainingSeconds),
  null,
  "Railway draining window must be an exact decimal string between 30 and 60 seconds",
);
for (const [value, expected] of [["30", 30], ["45", 45], ["60", 60]]) {
  assert.equal(parseDrainSeconds(value), expected, "Valid draining window must be accepted");
}
for (const invalid of ["0", "25", "29", "61", "30s", "30.5", "30e0", " 30", "30 ", "030", "-30", 30, null]) {
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
  dockerfile.includes("(res.headers['content-type']||'').split(';')[0].trim().toLowerCase()==='application/json'&&valid?0:1"),
  "Docker liveness healthcheck must reject HTTP 200 non-JSON responses",
);


 // Exercise the actual Docker HEALTHCHECK command, not a reimplementation.
 // A 200 header followed by a truncated response must never mark a container healthy.
 const healthcheckLine = dockerfile.split("\n").find((line) => line.startsWith("HEALTHCHECK "));
 assert.ok(healthcheckLine, "Docker liveness healthcheck must be configured");
 assert.ok(
   /^HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD \[/.test(healthcheckLine),
   "Docker liveness must retain bounded 30s interval, 5s timeout, 20s startup grace and three retries",
 );

 const cmdMarker = " CMD ";
 assert.ok(healthcheckLine.includes(cmdMarker), "Docker healthcheck must use exec-form CMD");
 const healthcheckJson = healthcheckLine.slice(healthcheckLine.indexOf(cmdMarker) + cmdMarker.length);
 let healthcheckArgs;
 try {
   healthcheckArgs = JSON.parse(healthcheckJson);
 } catch {
   assert.fail("Docker healthcheck CMD must be valid JSON exec form");
 }
 assert.ok(Array.isArray(healthcheckArgs) && healthcheckArgs.length === 3,
   "Docker healthcheck must execute a Node inline probe");
 const [binary, flag, probeScript] = healthcheckArgs;
 assert.equal(typeof probeScript, "string", "Docker healthcheck probe must be a script string");
 assert.deepEqual([binary, flag], ["node", "-e"], "Docker healthcheck must use node -e");
 assert.match(probeScript, /host:\s*[\x27\x22]127\.0\.0\.1[\x27\x22]/,
   "Docker liveness must probe loopback, never an external endpoint");
 assert.match(probeScript, /path:\s*[\x27\x22]\/api\/health[\x27\x22]/,
   "Docker liveness must target the local health endpoint");
 assert.match(probeScript, /timeout:\s*4000/,
   "Docker liveness request timeout must remain below the 5s container deadline");
 let responseMode = "complete";
 const probeServer = createServer((request, response) => {
   assert.equal(request.url, "/api/health", "Docker healthcheck must target liveness");

   const contentType = responseMode === "html" ? "text/html" : responseMode === "problem-json" ? "application/problem+json" : responseMode === "json-seq" ? "application/json-seq" : responseMode === "plain-text" ? "text/plain" : responseMode === "uppercase-json" ? "APPLICATION/JSON; charset=utf-8" : "application/json; charset=utf-8";
   const healthy = { service: "economic-intelligence-os", status: "ok", checks: { application: "ok" }, timestamp: new Date().toISOString() };
   if (responseMode === "compressed-json") {
     // Compressed JSON is not a valid uncompressed liveness payload.
     const body = gzipSync(Buffer.from(JSON.stringify(healthy)));
     response.writeHead(200, { "Content-Type": contentType, "Content-Encoding": "gzip", "Content-Length": String(body.length) });
     response.end(body);
     return;
   }
   if (responseMode === "stalled-body") {
     // A 200 JSON response that never completes must fail the bounded probe.
     response.writeHead(200, { "Content-Type": contentType });
     response.flushHeaders();
     return;
   }
   if (responseMode === "aborted-chunked") {
     // An interrupted chunked transfer has no declared Content-Length.
     // A valid-looking JSON prefix must not be accepted without a complete response.
     response.writeHead(200, { "Content-Type": contentType });
     response.flushHeaders();
     response.write(JSON.stringify(healthy));
     setTimeout(() => response.socket?.destroy(), 50);
     return;
   }
   if (responseMode === "truncated") {
     response.writeHead(200, { "Content-Length": "100", "Content-Type": contentType });
     response.flushHeaders();
     response.write("partial");
     setTimeout(() => response.socket?.destroy(), 50);
     return;
   }
   if (responseMode === "boundary" || responseMode === "oversized") {
     const size = responseMode === "boundary" ? 65536 : 65537;
     const emptyPadding = JSON.stringify({ ...healthy, padding: "" });
     const body = JSON.stringify({ ...healthy, padding: "x".repeat(size - Buffer.byteLength(emptyPadding)) });
     assert.equal(Buffer.byteLength(body), size, "Boundary test must use the exact byte count");
     response.writeHead(200, { "Content-Length": String(size), "Content-Type": contentType });
     response.end(body);
     return;
   }
   const variants = {
     "invalid-json": "{",
     "whitespace-json": "   \n\t  ",
     "duplicate-json": JSON.stringify(healthy) + JSON.stringify(healthy),
     "padded-valid-json": " \n" + JSON.stringify(healthy) + "\t ",
     "null-json": "null",
     "array-json": "[]",
     "string-json": JSON.stringify("healthy"),
     "boolean-json": "true",
     "trailing-json": JSON.stringify({ service: "economic-intelligence-os", status: "ok", checks: { application: "ok" }, timestamp: new Date().toISOString() }) + " garbage",
     "wrong-service": JSON.stringify({ ...healthy, service: "other-service" }),
     "missing-service": JSON.stringify({ ...healthy, service: undefined }),
     "null-service": JSON.stringify({ ...healthy, service: null }),
     "empty-service": JSON.stringify({ ...healthy, service: "" }),
     "missing-status": JSON.stringify({ ...healthy, status: undefined }),
     "null-status": JSON.stringify({ ...healthy, status: null }),
     "empty-status": JSON.stringify({ ...healthy, status: "" }),
     "wrong-status": JSON.stringify({ ...healthy, status: "degraded" }),
     "wrong-check": JSON.stringify({ ...healthy, checks: { application: "failed" } }),
     "boolean-application-check": JSON.stringify({ ...healthy, checks: { application: true } }),
     "numeric-application-check": JSON.stringify({ ...healthy, checks: { application: 1 } }),
     "uppercase-application-check": JSON.stringify({ ...healthy, checks: { application: "OK" } }),
     "padded-application-check": JSON.stringify({ ...healthy, checks: { application: " ok " } }),
     "missing-application-check": JSON.stringify({ ...healthy, checks: {} }),
     "null-application-check": JSON.stringify({ ...healthy, checks: { application: null } }),
     "empty-application-check": JSON.stringify({ ...healthy, checks: { application: "" } }),
    "missing-checks": JSON.stringify({ ...healthy, checks: undefined }),
    "null-checks": JSON.stringify({ ...healthy, checks: null }),
    "array-checks": JSON.stringify({ ...healthy, checks: ["ok"] }),
    "string-checks": JSON.stringify({ ...healthy, checks: "ok" }),
    "missing-timestamp": JSON.stringify({ ...healthy, timestamp: undefined }),
    "stale-timestamp": JSON.stringify({ ...healthy, timestamp: new Date(Date.now() - 600_000).toISOString() }),
    "future-timestamp": JSON.stringify({ ...healthy, timestamp: new Date(Date.now() + 600_000).toISOString() }),
    "invalid-timestamp": JSON.stringify({ ...healthy, timestamp: "not-a-date" }),
    // ISO-8601 representations must match the canonical UTC millisecond format.
    "offset-timestamp": JSON.stringify({ ...healthy, timestamp: healthy.timestamp.replace("Z", "+00:00") }),
    "no-milliseconds-timestamp": JSON.stringify({ ...healthy, timestamp: healthy.timestamp.replace(/\.\d{3}Z$/, "Z") }),
    "numeric-timestamp": JSON.stringify({ ...healthy, timestamp: Date.now() }),
    "null-timestamp": JSON.stringify({ ...healthy, timestamp: null }),
    "empty-timestamp": JSON.stringify({ ...healthy, timestamp: "" }),
   };
   const body = variants[responseMode] ?? JSON.stringify(healthy);
   // Chunked responses have no Content-Length; liveness must still validate
   // the complete JSON body rather than depending on a length header.
   if (["chunked", "chunked-invalid", "chunked-boundary", "chunked-oversized"].includes(responseMode)) {
     response.writeHead(200, { "Content-Type": contentType });
     const targetBytes = responseMode === "chunked-boundary" ? 65536 : responseMode === "chunked-oversized" ? 65537 : null;
     const base = JSON.stringify({ ...healthy, padding: "" });
     const payload = targetBytes === null ? (responseMode === "chunked" ? body : "{") :
       JSON.stringify({ ...healthy, padding: "x".repeat(targetBytes - Buffer.byteLength(base)) });
     if (targetBytes !== null) assert.equal(Buffer.byteLength(payload), targetBytes);
     const midpoint = Math.max(1, Math.floor(payload.length / 2));
     response.write(payload.slice(0, midpoint));
     response.end(payload.slice(midpoint));
     return;
   }
   const noContent = responseMode === "no-content";
   const empty = responseMode === "empty";
   const headers = { "Content-Length": noContent || empty ? "0" : String(Buffer.byteLength(body)) };
   if (responseMode !== "missing-type") headers["Content-Type"] = contentType;
   const statusCode = responseMode === "created" ? 201 : responseMode === "partial-content" ? 206 : responseMode === "redirect" ? 302 : responseMode === "permanent-redirect" ? 301 : responseMode === "temporary-redirect" ? 307 : responseMode === "permanent-redirect-308" ? 308 : responseMode === "server-error" ? 500 : responseMode === "bad-gateway" ? 502 : responseMode === "gateway-timeout" ? 504 : responseMode === "unavailable" ? 503 : responseMode === "rate-limited" ? 429 : responseMode === "unauthorized" ? 401 : responseMode === "forbidden" ? 403 : responseMode === "not-found" ? 404 : responseMode === "request-timeout" ? 408 : noContent ? 204 : 200;
   response.writeHead(statusCode, headers);
   response.end(noContent || empty ? undefined : body);
 });
 await new Promise((resolve) => probeServer.listen(0, "127.0.0.1", resolve));
 const exec = promisify(execFile);
 // Only an intentional silent exit(1) proves the healthcheck rejected a bad
 // response. A JavaScript crash, missing runtime or timeout must fail CI,
 // not masquerade as a successful negative regression.
 function isExpectedProbeRejection(error) {
   return error?.code === 1 &&
     error?.signal == null &&
     error?.killed !== true &&
     String(error?.stderr ?? "") === "";
 }
 assert.equal(isExpectedProbeRejection({ code: 1, stderr: "" }), true,
   "A silent healthcheck exit(1) must count as a rejection");
 for (const error of [
   { code: 1, stderr: "SyntaxError: Unexpected token" },
   { code: 2, stderr: "" },
   { code: "ENOENT", stderr: "" },
   { code: 1, signal: "SIGTERM", killed: true, stderr: "" },
 ]) {
   assert.equal(isExpectedProbeRejection(error), false,
     "Harness errors must never satisfy a negative healthcheck regression");
 }
 async function runHealthcheck() {
   try {
     await exec(process.execPath, ["-e", probeScript], {
       env: { ...process.env, PORT: String(probeServer.address().port) },
       timeout: 6500,
     });
     return true;
   } catch (error) {
     if (!isExpectedProbeRejection(error)) throw error;
     return false;
   }
 }
 try {
   for (const [mode, expected] of [
     ["complete", true],
     ["chunked", true],
     ["chunked-boundary", true],
     ["chunked-oversized", false],
     ["chunked-invalid", false],
     ["boundary", true],
     ["oversized", false],
     ["empty", false],
     ["no-content", false],
     ["created", false],
     ["partial-content", false],
     ["redirect", false],
     ["permanent-redirect", false],
     ["temporary-redirect", false],
     ["permanent-redirect-308", false],
     ["server-error", false],
     ["bad-gateway", false],
     ["gateway-timeout", false],
     ["unavailable", false],
     ["rate-limited", false],
     ["unauthorized", false],
     ["forbidden", false],
     ["not-found", false],
     ["request-timeout", false],
     ["html", false],
     ["compressed-json", false],
     ["problem-json", false],
     ["json-seq", false],
     ["plain-text", false],
     ["uppercase-json", true],
     ["missing-type", false],
     ["invalid-json", false],
     ["whitespace-json", false],
     ["duplicate-json", false],
     ["padded-valid-json", true],
     ["null-json", false],
     ["array-json", false],
     ["string-json", false],
     ["boolean-json", false],
     ["trailing-json", false],
     ["wrong-service", false],
     ["missing-service", false],
     ["null-service", false],
     ["empty-service", false],
     ["missing-status", false],
     ["null-status", false],
     ["empty-status", false],
     ["wrong-status", false],
     ["wrong-check", false],
     ["boolean-application-check", false],
     ["numeric-application-check", false],
     ["uppercase-application-check", false],
     ["padded-application-check", false],
     ["missing-application-check", false],
     ["null-application-check", false],
     ["empty-application-check", false],
     ["missing-checks", false],
     ["null-checks", false],
     ["array-checks", false],
     ["string-checks", false],
     ["missing-timestamp", false],
     ["stale-timestamp", false],
     ["future-timestamp", false],
     ["invalid-timestamp", false],
     ["offset-timestamp", false],
     ["no-milliseconds-timestamp", false],
     ["numeric-timestamp", false],
     ["null-timestamp", false],
     ["empty-timestamp", false],
     ["truncated", false],
     ["aborted-chunked", false],
     ["stalled-body", false],
   ]) {
     responseMode = mode;
     assert.equal(await runHealthcheck(), expected,
       `Docker healthcheck must ${expected ? "accept" : "reject"} ${mode} response`);
   }
 } finally {
   await new Promise((resolve) => probeServer.close(resolve));
 }

console.log("Railway deployment configuration regression checks passed.");
