import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const script = fileURLToPath(new URL("./production-smoke.mjs", import.meta.url));
let healthStatus = 200;
let readyStatus = 200;
let healthRedirect = false;
let readyRedirect = false;
let healthBodyStatus = "ok";
let applicationStatus = "ok";
let readyBodyStatus = "ready";
let cacheControl = "no-store";
let readyCacheControl = "no-store";
let healthAge = null;
let readyAge = null;
let healthXCache = null;
let readyXCache = null;
let healthCfCacheStatus = null;
let readyCfCacheStatus = null;
let contentType = "application/json";
let readyContentType = "application/json";
let service = "economic-intelligence-os";
let databaseStatus = "ok";
let latencyMs = 1;
let healthPadding = 0;
let readyPadding = 0;
let invalidHealthUtf8 = false;
let invalidReadyUtf8 = false;
const server = createServer((request, response) => {
  const health = request.url === "/api/health" || request.url === "/api/health-redirected";
  if ((request.url === "/api/health" && healthRedirect) ||
      (request.url === "/api/ready" && readyRedirect)) {
    response.writeHead(302, { location: health ? "/api/health-redirected" : "/api/ready-redirected" });
    response.end();
    return;
  }
  const headers = {
    "content-type": health ? contentType : readyContentType,
    "cache-control": health ? cacheControl : readyCacheControl,
  };
  const age = health ? healthAge : readyAge;
  if (age !== null) headers.age = age;
  const xCache = health ? healthXCache : readyXCache;
  if (xCache !== null) headers["x-cache"] = xCache;
  const cfCacheStatus = health ? healthCfCacheStatus : readyCfCacheStatus;
  if (cfCacheStatus !== null) headers["cf-cache-status"] = cfCacheStatus;
  response.writeHead(health ? healthStatus : readyStatus, headers);
  const body = JSON.stringify(health
    ? { status: healthBodyStatus, service, checks: { application: applicationStatus }, padding: "x".repeat(healthPadding) }
    : { status: readyBodyStatus, service, dependencies: { database: { status: databaseStatus, latencyMs } }, padding: "x".repeat(readyPadding) });
  if (health ? invalidHealthUtf8 : invalidReadyUtf8) {
    // Invalid byte inside an otherwise valid JSON string: lossy UTF-8 decoding would pass.
    const marker = '"padding":"';
    const offset = body.indexOf(marker) + marker.length;
    response.end(Buffer.concat([Buffer.from(body.slice(0, offset)), Buffer.from([0xff]), Buffer.from(body.slice(offset))]));
  } else {
    response.end(body);
  }
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
  invalidHealthUtf8 = true;
  assert.equal(await run(), false, "Malformed UTF-8 liveness JSON must block promotion");
  invalidHealthUtf8 = false;
  invalidReadyUtf8 = true;
  assert.equal(await run(), false, "Malformed UTF-8 readiness JSON must block promotion");
  invalidReadyUtf8 = false;
  healthAge = "12";
  assert.equal(await run(), false, "Cached liveness must block promotion even with no-store");
  healthAge = "0";
  assert.equal(await run(), true, "Zero-age liveness response is fresh");
  healthAge = null;
  readyAge = "8";
  assert.equal(await run(), false, "Cached readiness must block promotion even with no-store");
  readyAge = "-1";
  assert.equal(await run(), false, "Malformed readiness Age header must block promotion");
  readyAge = "0";
  assert.equal(await run(), true, "Zero-age readiness response is fresh");
  readyAge = null;
  healthXCache = "HIT from CDN";
  assert.equal(await run(), false, "Liveness cache HIT must block promotion even with zero or absent Age");
  healthXCache = "MISS from CDN";
  assert.equal(await run(), true, "Liveness cache MISS must not block promotion");
  healthXCache = null;
  readyXCache = "HIT";
  assert.equal(await run(), false, "Readiness cache HIT must block promotion");
  readyXCache = null;
  healthCfCacheStatus = "HIT";
  assert.equal(await run(), false, "Cloudflare liveness cache HIT must block promotion");
  healthCfCacheStatus = null;
  readyCfCacheStatus = "STALE";
  assert.equal(await run(), false, "Cloudflare stale readiness must block promotion");
  readyCfCacheStatus = "DYNAMIC";
  assert.equal(await run(), true, "Cloudflare dynamic readiness must pass");
  readyCfCacheStatus = null;
  healthRedirect = true;
  assert.equal(await run(), false, "Redirected liveness must not pass even if the target is healthy");
  healthRedirect = false;
  readyRedirect = true;
  assert.equal(await run(), false, "Redirected readiness must not pass even if the target is healthy");
  readyRedirect = false;
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
  contentType = 'application/json; charset="UTF-8"';
  assert.equal(await run(), true, "Quoted UTF-8 charset must pass");
  contentType = "application/json; charset=iso-8859-1";
  assert.equal(await run(), false, "Non-UTF-8 liveness charset must block promotion");
  contentType = "application/json; charset=utf-8; charset=latin1";
  assert.equal(await run(), false, "Conflicting liveness charsets must block promotion");
  contentType = "application/json; charset";
  assert.equal(await run(), false, "Malformed liveness charset must block promotion");
  contentType = "application/json";
  readyContentType = "application/json; charset=latin1";
  assert.equal(await run(), false, "Non-UTF-8 readiness charset must block promotion");
  readyContentType = "application/json; charset=utf-8; charset=utf-8";
  assert.equal(await run(), false, "Duplicate readiness charsets must block promotion");
  readyContentType = "application/json";
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
  cacheControl = "no-store, public";
  assert.equal(await run(), false, "Contradictory public liveness caching must block promotion");
  cacheControl = "public, NO-STORE";
  assert.equal(await run(), false, "Public liveness caching must fail regardless of directive order");
  cacheControl = "private, NO-STORE";
  assert.equal(await run(), true, "Case-insensitive no-store directive must pass");
  cacheControl = "no-store";
  readyCacheControl = "public, max-age=60";
  assert.equal(await run(), false, "Cacheable readiness must block promotion even when liveness is healthy");
  readyCacheControl = "no-store=false";
  assert.equal(await run(), false, "Misleading readiness cache directive must block promotion");
  readyCacheControl = "no-store, public";
  assert.equal(await run(), false, "Contradictory public readiness caching must block promotion");
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
