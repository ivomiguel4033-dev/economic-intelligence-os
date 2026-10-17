import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const script = fileURLToPath(new URL("./production-smoke.mjs", import.meta.url));
let healthStatus = 200;
let readyStatus = 200;
let healthBodyStatus = "ok";
let applicationStatus = "ok";
let readyBodyStatus = "ready";
let cacheControl = "no-store";
let readyCacheControl = "no-store";
let contentType = "application/json";
let service = "economic-intelligence-os";
let databaseStatus = "ok";
let latencyMs = 1;
let healthPadding = 0;
let readyPadding = 0;
const server = createServer((request, response) => {
  const health = request.url === "/api/health";
  response.writeHead(health ? healthStatus : readyStatus, {
    "content-type": contentType,
    "cache-control": health ? cacheControl : readyCacheControl,
  });
  response.end(JSON.stringify(health
    ? { status: healthBodyStatus, service, checks: { application: applicationStatus }, padding: "x".repeat(healthPadding) }
    : { status: readyBodyStatus, service, dependencies: { database: { status: databaseStatus, latencyMs } }, padding: "x".repeat(readyPadding) }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
async function run(candidateOrigin = origin) {
  try {
    await exec(process.execPath, [script, candidateOrigin], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}
try {
  assert.equal(await run(), true, "Healthy deployment must pass");
  assert.equal(await run(origin + "\\"), false, "Trailing backslash must not be normalized into a valid origin");
  assert.equal(await run(origin.replace("://", ":\\")), false, "Scheme backslash must not be normalized into a valid origin");
  assert.equal(await run(origin + "\n"), false, "Trailing newline must not be normalized into a valid origin");
  assert.equal(await run(origin + "?"), false, "Empty query delimiter must not be accepted as an origin");
  assert.equal(await run(origin + "#"), false, "Empty fragment delimiter must not be accepted as an origin");
  assert.equal(await run(origin + "?debug=true"), false, "Query parameters must not be accepted as an origin");
  assert.equal(await run(origin + "#fragment"), false, "Fragments must not be accepted as an origin");
  healthBodyStatus = "degraded";
  assert.equal(await run(), false, "Degraded liveness body must block promotion even with HTTP 200");
  healthBodyStatus = "ok";
  applicationStatus = "degraded";
  assert.equal(await run(), false, "Degraded application check must block promotion");
  applicationStatus = "ok";
  readyBodyStatus = "not_ready";
  assert.equal(await run(), false, "Incorrect readiness body must block promotion even with HTTP 200");
  readyBodyStatus = "ready";
  contentType = "text/plain; note=application/json";
  assert.equal(await run(), false, "Misleading JSON content type must block promotion");
  contentType = "application/json-malicious";
  assert.equal(await run(), false, "JSON media type suffix must block promotion");
  contentType = "APPLICATION/JSON; charset=utf-8";
  assert.equal(await run(), true, "JSON media type with charset and mixed case must pass");
  contentType = "application/json";
  readyStatus = 503;
  assert.equal(await run(), false, "Database outage must block promotion");
  readyStatus = 200;
  healthStatus = 503;
  assert.equal(await run(), false, "Liveness failure must block promotion");
  healthStatus = 200;
  cacheControl = "public, max-age=60";
  assert.equal(await run(), false, "Cacheable health responses must block promotion");
  cacheControl = "public, x-no-store";
  assert.equal(await run(), false, "Misleading cache directive must block promotion");
  cacheControl = "no-store=false";
  assert.equal(await run(), false, "Parameterized no-store must block promotion");
  cacheControl = "private, NO-STORE";
  assert.equal(await run(), true, "Case-insensitive no-store directive must pass");
  cacheControl = "no-store";
  readyCacheControl = "public, max-age=60";
  assert.equal(await run(), false, "Cacheable readiness must block promotion even when liveness is healthy");
  readyCacheControl = "no-store=false";
  assert.equal(await run(), false, "Misleading readiness cache directive must block promotion");
  readyCacheControl = "no-store";
  service = "unexpected-service";
  assert.equal(await run(), false, "Unexpected service identity must block promotion");
  service = "economic-intelligence-os";
  databaseStatus = "degraded";
  assert.equal(await run(), false, "Degraded database must block promotion");
  databaseStatus = "ok";
  latencyMs = null;
  assert.equal(await run(), false, "Missing database latency must block promotion");
  latencyMs = -1;
  assert.equal(await run(), false, "Negative database latency must block promotion");
  latencyMs = "1";
  assert.equal(await run(), false, "String database latency must block promotion");
  latencyMs = true;
  assert.equal(await run(), false, "Boolean database latency must block promotion");
  latencyMs = { value: 1 };
  assert.equal(await run(), false, "Object database latency must block promotion");
  latencyMs = 0;
  assert.equal(await run(), true, "Zero database latency is valid");
  healthPadding = 60_000;
  assert.equal(await run(), true, "Bounded liveness payload must pass below 64 KiB");
  healthPadding = 70_000;
  assert.equal(await run(), false, "Oversized liveness payload must block promotion");
  healthPadding = 0;
  readyPadding = 60_000;
  assert.equal(await run(), true, "Bounded readiness payload must pass below 64 KiB");
  readyPadding = 70_000;
  assert.equal(await run(), false, "Oversized readiness payload must block promotion");
  readyPadding = 0;
  console.log("Post-deploy smoke probe regression checks passed");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
