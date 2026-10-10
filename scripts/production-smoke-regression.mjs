import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const script = fileURLToPath(new URL("./production-smoke.mjs", import.meta.url));
let healthStatus = 200;
let readyStatus = 200;
let cacheControl = "no-store";
let contentType = "application/json";
let service = "economic-intelligence-os";
let databaseStatus = "ok";
let latencyMs = 1;
const server = createServer((request, response) => {
  const health = request.url === "/api/health";
  response.writeHead(health ? healthStatus : readyStatus, {
    "content-type": contentType,
    "cache-control": cacheControl,
  });
  response.end(JSON.stringify(health
    ? { status: "ok", service, checks: { application: "ok" } }
    : { status: "ready", service, dependencies: { database: { status: databaseStatus, latencyMs } } }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
async function run() {
  try {
    await exec(process.execPath, [script, origin], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}
try {
  assert.equal(await run(), true, "Healthy deployment must pass");
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
  latencyMs = 0;
  assert.equal(await run(), true, "Zero database latency is valid");
  console.log("Post-deploy smoke probe regression checks passed");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
