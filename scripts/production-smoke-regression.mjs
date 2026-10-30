import assert from "node:assert/strict";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const script = fileURLToPath(new URL("./production-smoke.mjs", import.meta.url));
const requestCacheHeaders = new Map();
let healthStatus = 200;
let readyStatus = 200;
let healthDeclaredContentLength = null;
let readyDeclaredContentLength = null;
let healthContentRange = null;
let readyContentRange = null;
let healthContentEncoding = null;
let readyContentEncoding = null;
let healthSetCookie = null;
let readySetCookie = null;
let healthVary = null;
let readyVary = null;
let healthWwwAuthenticate = null;
let readyWwwAuthenticate = null;
let healthRetryAfter = null;
let readyRetryAfter = null;
let healthRefresh = null;
let readyRefresh = null;
let healthLocation = null;
let readyLocation = null;
let healthXAccelRedirect = null;
let readyXAccelRedirect = null;
let healthDelegationHeader = null;
let readyDelegationHeader = null;
let healthRedirect = false;
let readyRedirect = false;
let healthBodyStatus = "ok";
let applicationStatus = "ok";
let readyBodyStatus = "ready";
let healthTimestamp = null;
let readyTimestamp = null;
let cacheControl = "no-store";
let readyCacheControl = "no-store";
let healthAge = null;
let readyAge = null;
let healthDate = null;
let readyDate = null;
let healthExpires = null;
let readyExpires = null;
let healthWarning = null;
let readyWarning = null;
let healthXCache = null;
let readyXCache = null;
let healthXCacheHits = null;
let readyXCacheHits = null;
let healthXProxyCache = null;
let readyXProxyCache = null;
let healthXCacheStatus = null;
let readyXCacheStatus = null;
let healthCfCacheStatus = null;
let readyCfCacheStatus = null;
let healthCacheStatus = null;
let readyCacheStatus = null;
let healthCdnCacheControl = null;
let readyCdnCacheControl = null;
let healthSurrogateControl = null;
let readySurrogateControl = null;
let contentType = "application/json";
let readyContentType = "application/json";
let healthNoSniff = "nosniff";
let readyNoSniff = "nosniff";
let healthPoweredBy = null;
let readyPoweredBy = null;
let service = "economic-intelligence-os";
let databaseStatus = "ok";
let latencyMs = 1;
let healthPadding = 0;
let readyPadding = 0;
let invalidHealthUtf8 = false;
let invalidReadyUtf8 = false;
let invalidHealthJson = false;
let invalidReadyJson = false;
let healthBodyOverride = null;
let readyBodyOverride = null;
const server = createServer((request, response) => {
  if (request.url === "/api/health" || request.url === "/api/ready") {
    requestCacheHeaders.set(request.url, {
      method: request.method,
      accept: request.headers.accept,
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
      cacheControl: request.headers["cache-control"],
      pragma: request.headers.pragma,
      acceptEncoding: request.headers["accept-encoding"],
    });
  }
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
  const noSniff = health ? healthNoSniff : readyNoSniff;
  if (noSniff !== null) headers["x-content-type-options"] = noSniff;
  const poweredBy = health ? healthPoweredBy : readyPoweredBy;
  if (poweredBy !== null) headers["x-powered-by"] = poweredBy;
  const contentEncoding = health ? healthContentEncoding : readyContentEncoding;
  if (contentEncoding !== null) headers["content-encoding"] = contentEncoding;
  const contentRange = health ? healthContentRange : readyContentRange;
  if (contentRange !== null) headers["content-range"] = contentRange;
  const declaredContentLength = health ? healthDeclaredContentLength : readyDeclaredContentLength;
  if (declaredContentLength !== null) headers["content-length"] = declaredContentLength;
  const setCookie = health ? healthSetCookie : readySetCookie;
  if (setCookie !== null) headers["set-cookie"] = setCookie;
  const vary = health ? healthVary : readyVary;
  if (vary !== null) headers.vary = vary;
  const authChallenge = health ? healthWwwAuthenticate : readyWwwAuthenticate;
  if (authChallenge !== null) headers["www-authenticate"] = authChallenge;
  const retryAfter = health ? healthRetryAfter : readyRetryAfter;
  if (retryAfter !== null) headers["retry-after"] = retryAfter;
  const refresh = health ? healthRefresh : readyRefresh;
  if (refresh !== null) headers.refresh = refresh;
  const location = health ? healthLocation : readyLocation;
  if (location !== null) headers.location = location;
  const internalRedirect = health ? healthXAccelRedirect : readyXAccelRedirect;
  if (internalRedirect !== null) headers["x-accel-redirect"] = internalRedirect;
  const delegation = health ? healthDelegationHeader : readyDelegationHeader;
  if (delegation !== null) headers[delegation[0]] = delegation[1];
  const age = health ? healthAge : readyAge;
  if (age !== null) headers.age = age;
  const date = health ? healthDate : readyDate;
  if (date !== null) headers.date = date;
  const expires = health ? healthExpires : readyExpires;
  if (expires !== null) headers.expires = expires;
  const warning = health ? healthWarning : readyWarning;
  if (warning !== null) headers.warning = warning;
  const xCache = health ? healthXCache : readyXCache;
  if (xCache !== null) headers["x-cache"] = xCache;
  const xCacheHits = health ? healthXCacheHits : readyXCacheHits;
  if (xCacheHits !== null) headers["x-cache-hits"] = xCacheHits;
  const xProxyCache = health ? healthXProxyCache : readyXProxyCache;
  if (xProxyCache !== null) headers["x-proxy-cache"] = xProxyCache;
  const xCacheStatus = health ? healthXCacheStatus : readyXCacheStatus;
  if (xCacheStatus !== null) headers["x-cache-status"] = xCacheStatus;
  const cfCacheStatus = health ? healthCfCacheStatus : readyCfCacheStatus;
  if (cfCacheStatus !== null) headers["cf-cache-status"] = cfCacheStatus;
  const cacheStatus = health ? healthCacheStatus : readyCacheStatus;
  if (cacheStatus !== null) headers["cache-status"] = cacheStatus;
  const cdnPolicy = health ? healthCdnCacheControl : readyCdnCacheControl;
  if (cdnPolicy !== null) headers["cdn-cache-control"] = cdnPolicy;
  const surrogatePolicy = health ? healthSurrogateControl : readySurrogateControl;
  if (surrogatePolicy !== null) headers["surrogate-control"] = surrogatePolicy;
  response.writeHead(health ? healthStatus : readyStatus, headers);
  const body = JSON.stringify(health
    ? { status: healthBodyStatus, service, timestamp: healthTimestamp ?? new Date().toISOString(),
        checks: { application: applicationStatus }, padding: "x".repeat(healthPadding) }
    : { status: readyBodyStatus, service, timestamp: readyTimestamp ?? new Date().toISOString(),
        dependencies: { database: { status: databaseStatus, latencyMs } }, padding: "x".repeat(readyPadding) });
  const responseBody = (health ? healthBodyOverride : readyBodyOverride) ?? body;
  if (health ? invalidHealthJson : invalidReadyJson) {
    response.end('{"status":');
  } else if (health ? invalidHealthUtf8 : invalidReadyUtf8) {
    // Invalid byte inside an otherwise valid JSON string: lossy UTF-8 decoding would pass.
    const marker = '"padding":"';
    const offset = body.indexOf(marker) + marker.length;
    response.end(Buffer.concat([Buffer.from(body.slice(0, offset)), Buffer.from([0xff]), Buffer.from(body.slice(offset))]));
  } else {
    response.end(contentEncoding === "gzip" ? gzipSync(responseBody) : responseBody);
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
// A negative regression is valid only when the smoke gate itself rejected
// the response. A missing Node executable, CLI usage error, crash or timeout
// must fail the suite rather than masquerade as a successful fail-closed check.
function isExpectedSmokeRejection(error) {
  return error?.code === 1 &&
    error?.signal == null &&
    /^Production smoke FAILED: \S/m.test(String(error.stderr ?? ""));
}
async function run(candidateOrigin = origin) {
  try {
    await exec(process.execPath, [script, candidateOrigin], { timeout: 10_000 });
    return true;
  } catch (error) {
    if (!isExpectedSmokeRejection(error)) throw error;
    return false;
  }
}
try {
  assert.equal(isExpectedSmokeRejection({
    code: 1, signal: null, stderr: "Production smoke FAILED: /api/ready returned HTTP 503\n",
  }), true, "Explicit smoke rejection must count as a negative regression");
  for (const error of [
    { code: 2, stderr: "Usage: production-smoke <origin>" },
    { code: 1, stderr: "SyntaxError: Unexpected token" },
    { code: "ETIMEDOUT", signal: "SIGTERM", stderr: "" },
    { code: 1, stderr: "" },
  ]) {
    assert.equal(isExpectedSmokeRejection(error), false,
      "Harness failures must never satisfy a negative smoke regression");
  }
  assert.equal(await run(), true, "Healthy deployment must pass");
  // TextDecoder normally discards a UTF-8 BOM, which would allow a proxy to
  // alter the wire representation while preserving apparently valid JSON.
  healthBodyOverride = "\uFEFF" + JSON.stringify({
    status: "ok", service: "economic-intelligence-os", timestamp: new Date().toISOString(),
    checks: { application: "ok" },
  });
  assert.equal(await run(), false, "UTF-8 BOM in liveness JSON must block promotion");
  healthBodyOverride = null;
  readyBodyOverride = "\uFEFF" + JSON.stringify({
    status: "ready", service: "economic-intelligence-os", timestamp: new Date().toISOString(),
    dependencies: { database: { status: "ok", latencyMs: 1 } },
  });
  assert.equal(await run(), false, "UTF-8 BOM in readiness JSON must block promotion");
  readyBodyOverride = null;
  assert.equal(await run(), true, "Canonical UTF-8 health JSON must still pass");
  for (const path of ["/api/health", "/api/ready"]) {
    assert.deepEqual(requestCacheHeaders.get(path), {
      method: "GET",
      accept: "application/json",
      authorization: undefined,
      cookie: undefined,
      cacheControl: "no-store",
      pragma: "no-cache",
      acceptEncoding: "identity",
    }, `${path} must use an unauthenticated JSON GET and bypass intermediary caches`);
  }
  // Both public probes must preserve Next.js response hardening through the edge.
  healthNoSniff = null;
  assert.equal(await run(), false, "Missing liveness nosniff must block promotion");
  healthNoSniff = "nosniff";
  readyNoSniff = "invalid";
  assert.equal(await run(), false, "Incorrect readiness nosniff must block promotion");
  readyNoSniff = "nosniff";
  healthPoweredBy = "Next.js";
  assert.equal(await run(), false, "Liveness framework banner must block promotion");
  healthPoweredBy = null;
  readyPoweredBy = "Express";
  assert.equal(await run(), false, "Readiness framework banner must block promotion");
  readyPoweredBy = null;
  assert.equal(await run(), true, "Hardened health headers must pass");
  // A reverse proxy must not override the identity encoding requested by smoke.
  // Node fetch transparently decompresses gzip, so a compressed valid JSON body
  // would otherwise pass without this response-header guard.
  healthContentEncoding = "gzip";
  assert.equal(await run(), false, "Compressed liveness must block promotion");
  healthContentEncoding = null;
  readyContentEncoding = "gzip";
  assert.equal(await run(), false, "Compressed readiness must block promotion");
  readyContentEncoding = null;
  healthContentEncoding = "identity";
  readyContentEncoding = "identity";
  assert.equal(await run(), true, "Explicit identity encoding must remain valid");
  healthContentEncoding = null;
  readyContentEncoding = null;
  // Replayed JSON must fail even if a proxy replaces the HTTP Date with a fresh one.
  healthTimestamp = new Date(Date.now() - 6 * 60_000).toISOString();
  assert.equal(await run(), false, "Stale liveness body timestamp must block promotion");
  healthTimestamp = new Date(Date.now() + 6 * 60_000).toISOString();
  assert.equal(await run(), false, "Future liveness body timestamp must block promotion");
  healthTimestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  assert.equal(await run(), false, "Noncanonical liveness body timestamp must block promotion");
  healthTimestamp = null;
  readyTimestamp = new Date(Date.now() - 6 * 60_000).toISOString();
  assert.equal(await run(), false, "Stale readiness body timestamp must block promotion");
  readyTimestamp = "not-a-date";
  assert.equal(await run(), false, "Invalid readiness body timestamp must block promotion");
  readyTimestamp = "";
  assert.equal(await run(), false, "Empty readiness body timestamp must block promotion");
  readyTimestamp = null;
  assert.equal(await run(), true, "Fresh canonical body timestamps must pass");
  // A proxy-rewritten HTTP Date must not mask a replayed JSON timestamp.
  // Each timestamp is individually fresh here; only cross-checking catches drift.
  healthDate = new Date(Date.now() - 2 * 60_000).toUTCString();
  assert.equal(await run(), false, "Liveness body and HTTP Date differing by two minutes must block promotion");
  healthDate = new Date(Date.now() - 30_000).toUTCString();
  assert.equal(await run(), true, "Liveness Date within thirty seconds of its body timestamp must pass");
  healthDate = null;
  readyDate = new Date(Date.now() + 2 * 60_000).toUTCString();
  assert.equal(await run(), false, "Readiness body and HTTP Date differing by two minutes must block promotion");
  readyDate = new Date(Date.now() + 30_000).toUTCString();
  assert.equal(await run(), true, "Readiness Date within thirty seconds of its body timestamp must pass");
  readyDate = null;
  // Individually fresh timestamps and matching per-response HTTP Dates are
  // insufficient if liveness and readiness come from different time windows.
  const olderProbe = new Date(Date.now() - 2 * 60_000);
  healthTimestamp = olderProbe.toISOString();
  healthDate = olderProbe.toUTCString();
  assert.equal(await run(), false, "Two-minute-old liveness paired with current readiness must fail");
  healthTimestamp = null;
  healthDate = null;
  readyTimestamp = olderProbe.toISOString();
  readyDate = olderProbe.toUTCString();
  assert.equal(await run(), false, "Two-minute-old readiness paired with current liveness must fail");
  readyTimestamp = null;
  readyDate = null;
  const nearbyProbe = new Date(Date.now() - 30_000);
  healthTimestamp = nearbyProbe.toISOString();
  healthDate = nearbyProbe.toUTCString();
  assert.equal(await run(), true, "Probes within thirty seconds must remain valid");
  healthTimestamp = null;
  healthDate = null;
  healthSetCookie = "session=unexpected; Path=/; HttpOnly";
  assert.equal(await run(), false, "Liveness setting a cookie must block promotion");
  healthSetCookie = null;
  readySetCookie = "session=unexpected; Path=/; HttpOnly";
  assert.equal(await run(), false, "Readiness setting a cookie must block promotion");
  readySetCookie = null;
  assert.equal(await run(), true, "Stateless liveness and readiness must pass");
  // A healthy response that varies by caller credentials cannot establish that
  // the public production endpoints work for unauthenticated clients.
  healthVary = "Authorization";
  assert.equal(await run(), false, "Auth-dependent liveness must block promotion");
  healthVary = "Accept-Encoding, Cookie";
  assert.equal(await run(), false, "Cookie-dependent liveness must block promotion");
  healthVary = null;
  readyVary = "Proxy-Authorization";
  assert.equal(await run(), false, "Proxy-auth-dependent readiness must block promotion");
  readyVary = "*";
  assert.equal(await run(), false, "Wildcard readiness variation must block promotion");
  readyVary = null;
  // Client-address headers can make a proxy serve different health results to
  // the smoke client and real users. Do not promote on caller-dependent probes.
  healthVary = "Accept-Encoding, X-Forwarded-For";
  assert.equal(await run(), false, "Client-IP-dependent liveness must block promotion");
  healthVary = null;
  readyVary = "Forwarded";
  assert.equal(await run(), false, "RFC 7239 client-dependent readiness must block promotion");
  readyVary = "X-Real-IP";
  assert.equal(await run(), false, "Proxy client-IP-dependent readiness must block promotion");
  readyVary = null;
  // Client identity, locale and proxy routing can also select a different
  // response for the smoke probe than for real production traffic.
  for (const field of ["User-Agent", "Accept-Language", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Forwarded-Port", "X-Forwarded-Prefix", "X-Forwarded-Scheme", "X-Forwarded-Ssl", "X-Forwarded-Server", "X-Original-Host"]) {
    healthVary = `Accept-Encoding, ${field}`;
    assert.equal(await run(), false, `${field}-dependent liveness must block promotion`);
    healthVary = null;
    readyVary = field;
    assert.equal(await run(), false, `${field}-dependent readiness must block promotion`);
    readyVary = null;
  }
  // The probe sends Accept: application/json. A backend that varies by Accept
  // can serve healthy JSON to smoke while serving different content to users.
  healthVary = "Accept";
  assert.equal(await run(), false, "Content-negotiated liveness must block promotion");
  healthVary = null;
  readyVary = "Accept-Encoding, aCcEpT";
  assert.equal(await run(), false, "Case-insensitive content-negotiated readiness must block promotion");
  readyVary = null;
  // Invalid Vary syntax must not bypass credential-sensitive token detection.
  healthVary = '"Authorization"';
  assert.equal(await run(), false, "Quoted Authorization must not bypass Vary validation");
  healthVary = "Accept-Encoding,,Origin";
  assert.equal(await run(), false, "Empty Vary member on liveness must block promotion");
  healthVary = null;
  readyVary = "Origin; Cookie";
  assert.equal(await run(), false, "Semicolon-delimited Vary on readiness must block promotion");
  readyVary = "Accept-Encoding, ";
  assert.equal(await run(), false, "Trailing empty Vary member must block promotion");
  readyVary = null;
  healthVary = "Accept-Encoding";
  readyVary = "Accept-Encoding, Origin";
  assert.equal(await run(), true, "Non-authentication Vary headers remain valid");
  healthVary = null;
  readyVary = null;
  // An unknown Vary token may refer to a future proxy routing hint. The
  // promotion gate must reject it without needing another denylist update.
  healthVary = "Accept-Encoding, X-Original-URI";
  assert.equal(await run(), false, "Unknown liveness Vary token must block promotion");
  healthVary = null;
  readyVary = "X-Rewrite-URL";
  assert.equal(await run(), false, "Unknown readiness Vary token must block promotion");
  readyVary = null;
  healthVary = "ACCEPT-ENCODING";
  readyVary = "oRiGiN";
  assert.equal(await run(), true, "Allowlisted Vary fields must remain case-insensitive");
  healthVary = null;
  readyVary = null;
  healthWwwAuthenticate = 'Bearer realm="deployment"';
  assert.equal(await run(), false, "Liveness auth challenge must block promotion despite HTTP 200");
  healthWwwAuthenticate = null;
  readyWwwAuthenticate = 'Bearer realm="deployment"';
  assert.equal(await run(), false, "Readiness auth challenge must block promotion despite HTTP 200");
  readyWwwAuthenticate = null;
  healthRetryAfter = "30";
  assert.equal(await run(), false, "Liveness retry instruction must block promotion despite HTTP 200");
  healthRetryAfter = null;
  readyRetryAfter = "0";
  assert.equal(await run(), false, "Even zero-second readiness retry hint must block promotion");
  readyRetryAfter = null;
  assert.equal(await run(), true, "Unchallenged probes without retry hints must pass");
  // A reverse proxy or auth middleware may attach authentication metadata to
  // an HTTP 200 JSON response. Public health probes must remain unauthenticated.
  for (const [header, value] of [
    ["authentication-info", 'nextnonce="unexpected"'],
    ["proxy-authenticate", 'Basic realm="proxy"'],
    ["proxy-authentication-info", 'nextnonce="unexpected"'],
  ]) {
    healthDelegationHeader = [header, value];
    assert.equal(await run(), false, `${header} on liveness must block promotion`);
    healthDelegationHeader = null;
    readyDelegationHeader = [header, value];
    assert.equal(await run(), false, `${header} on readiness must block promotion`);
    readyDelegationHeader = null;
  }
  assert.equal(await run(), true, "Unauthenticated health probes must remain valid");
  // A proxy can send an HTTP Refresh redirect alongside 200 and valid JSON.
  // Such a response must not count as proof that the release is ready.
  healthRefresh = "0; url=/login";
  assert.equal(await run(), false, "HTTP Refresh on liveness must block promotion");
  healthRefresh = null;
  readyRefresh = "30; url=https://example.com/login";
  assert.equal(await run(), false, "Delayed HTTP Refresh on readiness must block promotion");
  readyRefresh = null;
  assert.equal(await run(), true, "Probes without HTTP Refresh must still pass");
  // A proxy can return 200 and valid JSON while attaching a redirect hint.
  // Internal Nginx redirects must also never count as release evidence.
  healthLocation = "/login";
  assert.equal(await run(), false, "HTTP 200 Location on liveness must block promotion");
  healthLocation = null;
  readyLocation = "https://example.com/login";
  assert.equal(await run(), false, "HTTP 200 Location on readiness must block promotion");
  readyLocation = null;
  healthXAccelRedirect = "/internal/health";
  assert.equal(await run(), false, "Nginx internal redirect on liveness must block promotion");
  healthXAccelRedirect = null;
  readyXAccelRedirect = "/internal/ready";
  assert.equal(await run(), false, "Nginx internal redirect on readiness must block promotion");
  readyXAccelRedirect = null;
  // Sendfile/reproxy delegate responses; Content-Location can identify a different resource.
  // A valid JSON body alongside these hints cannot prove the intended endpoint is healthy.
  for (const [header, value] of [["x-sendfile", "/private/health.json"], ["x-reproxy-url", "https://other.example/health"], ["content-location", "/api/health-from-cache"]]) {
    healthDelegationHeader = [header, value];
    assert.equal(await run(), false, `${header} on liveness must block promotion`);
    healthDelegationHeader = null;
    readyDelegationHeader = [header, value];
    assert.equal(await run(), false, `${header} on readiness must block promotion`);
    readyDelegationHeader = null;
  }
  assert.equal(await run(), true, "Probes without redirect or delegation hints must still pass");
  // Content-Disposition indicates a downloadable or browser-oriented response,
  // not a direct API health representation. Fail closed on either endpoint.
  for (const disposition of ["attachment; filename=health.json", "inline; filename=ready.json"]) {
    healthDelegationHeader = ["content-disposition", disposition];
    assert.equal(await run(), false, "Content-Disposition on liveness must block promotion");
    healthDelegationHeader = null;
    readyDelegationHeader = ["content-disposition", disposition];
    assert.equal(await run(), false, "Content-Disposition on readiness must block promotion");
    readyDelegationHeader = null;
  }
  assert.equal(await run(), true, "Direct health JSON without Content-Disposition must pass");
  // Proxy-Status may report an upstream failure even when the HTTP status and
  // health JSON look healthy. Check both endpoints and multi-hop reports.
  healthDelegationHeader = ["proxy-status", "edge; error=connection_timeout"];
  assert.equal(await run(), false, "Upstream proxy error on liveness must block promotion");
  healthDelegationHeader = null;
  readyDelegationHeader = ["proxy-status", "edge; next-hop=app, gateway; error=connection_refused"];
  assert.equal(await run(), false, "Upstream proxy error in a later readiness hop must block promotion");
  readyDelegationHeader = ["proxy-status", "edge; next-hop=app"];
  healthDelegationHeader = ["proxy-status", "edge; next-hop=app"];
  assert.equal(await run(), true, "Informational Proxy-Status without errors remains valid");
  healthDelegationHeader = null;
  readyDelegationHeader = null;
  // Proxy-Status can disclose an upstream failure even without an error parameter.
  // HTTP 200 from the edge must not hide a non-200 response from the application.
  readyDelegationHeader = ["proxy-status", "edge; received-status=503"];
  assert.equal(await run(), false, "Upstream readiness HTTP 503 masked by proxy 200 must block promotion");
  readyDelegationHeader = ["proxy-status", "edge; received-status=200"];
  assert.equal(await run(), true, "Successful upstream readiness status remains valid");
  readyDelegationHeader = null;
  healthDelegationHeader = ["proxy-status", "edge; received-status=200, shield; received-status=502"];
  assert.equal(await run(), false, "A failed later proxy hop must block liveness promotion");
  healthDelegationHeader = ["proxy-status", 'edge; received-status="200"'];
  assert.equal(await run(), false, "Malformed quoted upstream status must block liveness promotion");
  healthDelegationHeader = ["proxy-status", "edge; received-status=200"];
  assert.equal(await run(), true, "Successful upstream liveness status remains valid");
  healthDelegationHeader = null;
  // Legacy proxy status headers must not mask failed application responses.
  readyDelegationHeader = ["x-upstream-status", "503"];
  assert.equal(await run(), false, "Upstream readiness 503 masked by edge 200 must block promotion");
  readyDelegationHeader = ["x-upstream-status", "200"];
  assert.equal(await run(), true, "Successful upstream readiness status header must pass");
  readyDelegationHeader = ["x-upstream-status", "200, 503"];
  assert.equal(await run(), false, "Ambiguous upstream readiness statuses must block promotion");
  readyDelegationHeader = null;
  healthDelegationHeader = ["x-original-status", "502"];
  assert.equal(await run(), false, "Original liveness 502 masked by edge 200 must block promotion");
  healthDelegationHeader = ["x-original-status", "200"];
  assert.equal(await run(), true, "Successful original liveness status header must pass");
  healthDelegationHeader = ["x-original-status", "unknown"];
  assert.equal(await run(), false, "Malformed original liveness status must block promotion");
  healthDelegationHeader = null;
  // Deferred HTTP trailers can carry proxy failures after the initial 200.
  // The fetch smoke gate cannot inspect them, so both probes must reject them.
  healthDelegationHeader = ["trailer", "proxy-status"];
  assert.equal(await run(), false, "Deferred liveness proxy metadata must block promotion");
  healthDelegationHeader = null;
  readyDelegationHeader = ["trailer", "grpc-status"];
  assert.equal(await run(), false, "Deferred readiness error metadata must block promotion");
  readyDelegationHeader = null;
  assert.equal(await run(), true, "Responses without trailers must remain valid");
  healthContentRange = "bytes 0-10/100";
  assert.equal(await run(), false, "HTTP 200 partial liveness must block promotion");
  healthContentRange = null;
  readyContentRange = "bytes 0-10/100";
  assert.equal(await run(), false, "HTTP 200 partial readiness must block promotion");
  readyContentRange = null;
  assert.equal(await run(), true, "Full health and readiness responses must still pass");
  healthDeclaredContentLength = "65537";
  assert.equal(await run(), false, "Oversized declared liveness response must block promotion before streaming");
  healthDeclaredContentLength = "0";
  assert.equal(await run(), false, "Zero declared liveness response length must block promotion");
  healthDeclaredContentLength = null;
  readyDeclaredContentLength = "65537";
  assert.equal(await run(), false, "Oversized declared readiness response must block promotion before streaming");
  readyDeclaredContentLength = "0";
  assert.equal(await run(), false, "Zero declared readiness response length must block promotion");
  readyDeclaredContentLength = null;
  assert.equal(await run(), true, "Normal probes without declared content length must pass");
  // When a proxy supplies Content-Length, it must agree with the JSON body.
  // Include a positive control so the gate does not reject valid framed probes.
  const lengthMatchedHealth = JSON.stringify({
    status: "ok", service: "economic-intelligence-os",
    timestamp: new Date().toISOString(), checks: { application: "ok" }, padding: "",
  });
  healthBodyOverride = lengthMatchedHealth;
  healthDeclaredContentLength = String(Buffer.byteLength(lengthMatchedHealth));
  assert.equal(await run(), true, "Accurate liveness Content-Length must pass");
  healthDeclaredContentLength = String(Buffer.byteLength(lengthMatchedHealth) + 1);
  assert.equal(await run(), false, "Overstated liveness Content-Length must block promotion");
  healthDeclaredContentLength = null;
  healthBodyOverride = null;
  const lengthMatchedReady = JSON.stringify({
    status: "ready", service: "economic-intelligence-os",
    timestamp: new Date().toISOString(),
    dependencies: { database: { status: "ok", latencyMs: 1 } }, padding: "",
  });
  readyBodyOverride = lengthMatchedReady;
  readyDeclaredContentLength = String(Buffer.byteLength(lengthMatchedReady));
  assert.equal(await run(), true, "Accurate readiness Content-Length must pass");
  readyDeclaredContentLength = String(Buffer.byteLength(lengthMatchedReady) + 1);
  assert.equal(await run(), false, "Overstated readiness Content-Length must block promotion");
  readyDeclaredContentLength = null;
  readyBodyOverride = null;
  invalidHealthJson = true;
  assert.equal(await run(), false, "Malformed liveness JSON must block promotion");
  invalidHealthJson = false;
  invalidReadyJson = true;
  assert.equal(await run(), false, "Malformed readiness JSON must block promotion");
  invalidReadyJson = false;
  // Duplicate keys can make a failed probe appear healthy because JSON.parse
  // silently keeps the last value. Reject ambiguity at every object depth.
  const healthyJson = JSON.stringify({
    status: "ok", service: "economic-intelligence-os",
    timestamp: new Date().toISOString(), checks: { application: "ok" },
  });
  healthBodyOverride = healthyJson.replace('"status":"ok"', '"status":"degraded","status":"ok"');
  assert.equal(await run(), false, "Duplicate top-level liveness status must block promotion");
  healthBodyOverride = healthyJson.replace(
    '"status":"ok"', '"status":"degraded","st' + String.fromCharCode(92) + 'u0061tus":"ok"',
  );
  assert.equal(await run(), false, "Escaped duplicate liveness key must block promotion");
  healthBodyOverride = null;
  const readyJson = JSON.stringify({
    status: "ready", service: "economic-intelligence-os",
    timestamp: new Date().toISOString(),
    dependencies: { database: { status: "ok", latencyMs: 1 } },
  });
  readyBodyOverride = readyJson.replace(
    '"status":"ok","latencyMs":1', '"status":"down","status":"ok","latencyMs":1',
  );
  assert.equal(await run(), false, "Duplicate nested database status must block promotion");
  readyBodyOverride = null;
  healthBodyOverride = JSON.stringify({
    status: "ok", service: "economic-intelligence-os",
    timestamp: new Date().toISOString(), checks: { application: "ok" },
    metadata: [{ tag: "first" }, { tag: "second" }],
  });
  assert.equal(await run(), true, "Same JSON key in distinct objects remains valid");
  healthBodyOverride = null;
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
  healthDate = "Wed, 21 Oct 2015 07:28:00 GMT";
  assert.equal(await run(), false, "Stale liveness Date must block promotion despite no-store");
  healthDate = "Wed, 21 Oct 2099 07:28:00 GMT";
  assert.equal(await run(), false, "Future liveness Date must block promotion");
  healthDate = "1";
  assert.equal(await run(), false, "Malformed liveness Date must block promotion");
  healthDate = new Date().toUTCString();
  assert.equal(await run(), true, "Fresh liveness Date must pass");
  healthDate = null;
  readyDate = "Wed, 21 Oct 2015 07:28:00 GMT";
  assert.equal(await run(), false, "Stale readiness Date must block promotion");
  readyDate = "Tue, 21 Oct 2015 07:28:00 GMT";
  assert.equal(await run(), false, "Noncanonical readiness Date must block promotion");
  readyDate = new Date().toUTCString();
  assert.equal(await run(), true, "Fresh readiness Date must pass");
  readyDate = null;
  healthExpires = "Wed, 21 Oct 2015 07:28:00 GMT";
  assert.equal(await run(), true, "Expired liveness Expires date must pass");
  healthExpires = "Wed, 21 Oct 2099 07:28:00 GMT";
  assert.equal(await run(), false, "Future liveness Expires must block promotion");
  healthExpires = "not-a-date";
  assert.equal(await run(), false, "Malformed liveness Expires must block promotion");
  healthExpires = "1";
  assert.equal(await run(), false, "Numeric liveness Expires must not parse as an old date");
  healthExpires = "Wed, 21 Oct 2015 07:28:00 UTC";
  assert.equal(await run(), false, "Noncanonical liveness Expires timezone must block promotion");
  healthExpires = null;
  readyExpires = "0";
  assert.equal(await run(), true, "Explicit zero readiness Expires must pass");
  readyExpires = "-1";
  assert.equal(await run(), true, "Conventional expired readiness Expires sentinel must pass");
  readyExpires = "Wed, 21 Oct 2099 07:28:00 GMT";
  assert.equal(await run(), false, "Future readiness Expires must block promotion");
  readyExpires = "1";
  assert.equal(await run(), false, "Numeric readiness Expires must block promotion");
  readyExpires = "Tue, 21 Oct 2015 07:28:00 GMT";
  assert.equal(await run(), false, "Mismatched weekday in readiness Expires must block promotion");
  readyExpires = null;
  healthWarning = '110 - "Response is stale"';
  assert.equal(await run(), false, "Legacy stale liveness Warning must block promotion");
  healthWarning = '199 - "Miscellaneous warning"';
  assert.equal(await run(), true, "Non-stale informational Warning must not block promotion");
  healthWarning = null;
  readyWarning = '199 - "Miscellaneous warning", 111 - "Revalidation failed"';
  assert.equal(await run(), false, "Combined Warning with failed readiness revalidation must block promotion");
  readyWarning = '112 - "Disconnected operation"';
  assert.equal(await run(), false, "Disconnected readiness Warning must block promotion");
  readyWarning = null;
  healthXCache = "HIT from CDN";
  assert.equal(await run(), false, "Liveness cache HIT must block promotion even with zero or absent Age");
  // Isolate X-Cache-Hits cases: a lingering X-Cache HIT must not invalidate their positive controls.
  healthXCache = null;
  healthXCacheHits = "1";
  assert.equal(await run(), false, "Cached liveness X-Cache-Hits must block promotion");
  healthXCacheHits = "invalid";
  assert.equal(await run(), false, "Malformed liveness X-Cache-Hits must block promotion");
  healthXCacheHits = "0";
  assert.equal(await run(), true, "Uncached liveness X-Cache-Hits must pass");
  healthXCacheHits = null;
  readyXCacheHits = "2";
  assert.equal(await run(), false, "Cached readiness X-Cache-Hits must block promotion");
  readyXCacheHits = "0";
  assert.equal(await run(), true, "Uncached readiness X-Cache-Hits must pass");
  readyXCacheHits = null;
  healthXCache = "MISS from CDN";
  assert.equal(await run(), true, "Liveness cache MISS must not block promotion");
  healthXCache = "STALE from CDN";
  assert.equal(await run(), false, "Stale liveness X-Cache response must block promotion");
  healthXCache = "MISS from CDN";
  assert.equal(await run(), true, "Liveness X-Cache MISS remains acceptable");
  healthXCache = "TCP_HIT from edge";
  assert.equal(await run(), false, "Akamai TCP_HIT liveness must block promotion");
  healthXCache = null;
  readyXCache = "UPDATING from edge";
  assert.equal(await run(), false, "Updating readiness X-Cache response must block promotion");
  readyXCache = "REVALIDATED from edge";
  assert.equal(await run(), false, "Revalidated readiness X-Cache response must block promotion");
  readyXCache = "TCP_MEM_HIT from edge";
  assert.equal(await run(), false, "Akamai TCP_MEM_HIT readiness must block promotion");
  readyXCache = "TCP_MISS from edge";
  assert.equal(await run(), true, "Akamai TCP_MISS readiness must pass");
  readyXCache = "HIT";
  assert.equal(await run(), false, "Readiness cache HIT must block promotion");
  readyXCache = null;
  healthXProxyCache = "HIT from proxy";
  assert.equal(await run(), false, "Proxy liveness cache HIT must block promotion");
  healthXProxyCache = "MISS";
  assert.equal(await run(), true, "Proxy liveness cache MISS must pass");
  healthXProxyCache = null;
  readyXProxyCache = "STALE";
  assert.equal(await run(), false, "Stale proxy readiness must block promotion");
  readyXProxyCache = "BYPASS";
  assert.equal(await run(), true, "Proxy readiness bypass must pass");
  readyXProxyCache = null;
  healthXCacheStatus = "HIT";
  assert.equal(await run(), false, "Nginx liveness X-Cache-Status HIT must block promotion");
  healthXCacheStatus = "MISS";
  assert.equal(await run(), true, "Nginx liveness X-Cache-Status MISS must pass");
  healthXCacheStatus = null;
  readyXCacheStatus = "STALE";
  assert.equal(await run(), false, "Nginx readiness X-Cache-Status STALE must block promotion");
  readyXCacheStatus = "UPDATING";
  assert.equal(await run(), false, "Nginx readiness X-Cache-Status UPDATING must block promotion");
  readyXCacheStatus = "REVALIDATED";
  assert.equal(await run(), false, "Nginx readiness X-Cache-Status REVALIDATED must block promotion");
  readyXCacheStatus = "BYPASS";
  assert.equal(await run(), true, "Nginx readiness X-Cache-Status BYPASS must pass");
  readyXCacheStatus = null;
  healthCfCacheStatus = "HIT";
  assert.equal(await run(), false, "Cloudflare liveness cache HIT must block promotion");
  healthCfCacheStatus = "DYNAMIC, HIT";
  assert.equal(await run(), false, "Combined Cloudflare cache status containing HIT must block promotion");
  healthCfCacheStatus = null;
  healthCacheStatus = "edge; hit";
  assert.equal(await run(), false, "Bare liveness Cache-Status hit must block promotion");
  healthCacheStatus = "edge; hit=?1";
  assert.equal(await run(), false, "Explicit true liveness Cache-Status hit must block promotion");
  healthCacheStatus = "edge; hit=?0";
  assert.equal(await run(), true, "Explicit false liveness Cache-Status hit must pass");
  healthCacheStatus = "edge; hit=?0, hit=?1";
  assert.equal(await run(), false, "Comma-delimited cache hit after a miss must block liveness promotion");
  healthCacheStatus = "edge; hit=1";
  assert.equal(await run(), false, "Malformed numeric liveness Cache-Status hit must fail closed");
  healthCacheStatus = "edge; hit=?2";
  assert.equal(await run(), false, "Invalid boolean liveness Cache-Status hit must fail closed");
  healthCacheStatus = "edge; hit=?0; ttl=30";
  assert.equal(await run(), true, "Explicit cache miss with TTL metadata must pass liveness");
  healthCacheStatus = "edge; fwd=uri-miss, shield; hit=?1";
  assert.equal(await run(), false, "Downstream cache hit must block liveness promotion");
  healthCacheStatus = "edge; fwd=uri-miss";
  assert.equal(await run(), true, "Forwarded cache miss must pass liveness");
  healthCacheStatus = null;
  readyCacheStatus = "edge; hit=?1";
  assert.equal(await run(), false, "Explicit true readiness Cache-Status hit must block promotion");
  readyCacheStatus = "edge; hit=?0";
  assert.equal(await run(), true, "Explicit false readiness Cache-Status hit must pass");
  readyCacheStatus = "edge; hit=?0, hit=bogus";
  assert.equal(await run(), false, "Malformed comma-delimited cache hit must block readiness promotion");
  readyCacheStatus = "edge; hit=bogus";
  assert.equal(await run(), false, "Malformed readiness Cache-Status hit must fail closed");
  readyCacheStatus = "edge; hit=?0, shield; hit=?1";
  assert.equal(await run(), false, "A downstream cache hit must override an upstream miss");
  readyCacheStatus = "edge; fwd=uri-miss, shield; HIT";
  assert.equal(await run(), false, "Downstream case-insensitive readiness cache hit must block promotion");
  readyCacheStatus = null;
  // Cache-Status fwd-status reports the origin response even if a proxy rewrites
  // the client-facing status to 200. Every hop must report a successful origin.
  healthCacheStatus = "edge; fwd-status=503";
  assert.equal(await run(), false, "Origin liveness HTTP 503 masked by proxy 200 must block promotion");
  healthCacheStatus = "edge; fwd-status=200";
  assert.equal(await run(), true, "Successful origin liveness status must pass");
  healthCacheStatus = null;
  readyCacheStatus = "edge; fwd-status=200, shield; fwd-status=502";
  assert.equal(await run(), false, "Failed later cache hop must block readiness promotion");
  readyCacheStatus = 'edge; fwd-status="200"';
  assert.equal(await run(), false, "Malformed quoted origin readiness status must block promotion");
  readyCacheStatus = "edge; fwd-status=304";
  assert.equal(await run(), false, "Revalidated origin readiness is not direct HTTP 200 evidence");
  readyCacheStatus = "edge; fwd-status=200";
  assert.equal(await run(), true, "Successful origin readiness status must pass");
  readyCacheStatus = null;
  readyCfCacheStatus = "STALE";
  assert.equal(await run(), false, "Cloudflare stale readiness must block promotion");
  readyCfCacheStatus = "DYNAMIC";
  assert.equal(await run(), true, "Cloudflare dynamic readiness must pass");
  readyCfCacheStatus = null;
  healthCdnCacheControl = "public, max-age=60";
  assert.equal(await run(), false, "CDN liveness caching policy must block promotion");
  healthCdnCacheControl = "no-store";
  assert.equal(await run(), true, "Explicit CDN no-store policy must pass liveness");
  healthCdnCacheControl = "no-store, s-maxage=60";
  assert.equal(await run(), false, "Contradictory CDN liveness policy must block promotion");
  healthCdnCacheControl = null;
  readyCdnCacheControl = "public";
  assert.equal(await run(), false, "CDN readiness public policy must block promotion");
  readyCdnCacheControl = null;
  healthSurrogateControl = "max-age=60";
  assert.equal(await run(), false, "Surrogate liveness caching policy must block promotion");
  healthSurrogateControl = null;
  readySurrogateControl = "max-age=60";
  assert.equal(await run(), false, "Surrogate readiness caching policy must block promotion");
  readySurrogateControl = "NO-STORE";
  assert.equal(await run(), true, "Case-insensitive surrogate no-store policy must pass readiness");
  readySurrogateControl = "no-store, max-age=60";
  assert.equal(await run(), false, "Contradictory surrogate readiness policy must block promotion");
  readySurrogateControl = null;
  healthRedirect = true;
  assert.equal(await run(), false, "Redirected liveness must not pass even if the target is healthy");
  healthRedirect = false;
  readyRedirect = true;
  assert.equal(await run(), false, "Redirected readiness must not pass even if the target is healthy");
  readyRedirect = false;
  // The deployment gate must reject malformed origins before any network request.
  // Match the validation error, not merely a failed HTTP connection.
  async function rejectsInvalidOrigin(candidateOrigin) {
    try {
      await exec(process.execPath, [script, candidateOrigin], { timeout: 10_000 });
      assert.fail("Invalid deployment origin unexpectedly passed");
    } catch (error) {
      assert.match(String(error.stderr ?? ""), /Expected an HTTPS origin without credentials, path, query or fragment|Origin must not contain whitespace, control characters or backslashes|Deployment origin must not use port 0|Local HTTP smoke origin must use a canonical loopback hostname/);
    }
  }
  await rejectsInvalidOrigin("http://example.com");
  await rejectsInvalidOrigin("https://example.com:0");
  await rejectsInvalidOrigin("http://127.0.0.1:0");
  await rejectsInvalidOrigin(origin.replace("127.0.0.1", "operator:secret@127.0.0.1"));
  await rejectsInvalidOrigin(origin.replace("127.0.0.1", "@127.0.0.1"));
  await rejectsInvalidOrigin(origin.replace("127.0.0.1", ":@127.0.0.1"));
  await rejectsInvalidOrigin(origin.replace("://", ":///"));
  await rejectsInvalidOrigin(origin.replace("://", ":////"));
  // URL normalization must not turn disguised hosts into permitted loopback origins.
  await rejectsInvalidOrigin(origin.replace("127.0.0.1", "%31%32%37.0.0.1"));
  await rejectsInvalidOrigin("https://%65xample.com");
  await rejectsInvalidOrigin(origin.replace("127.0.0.1", "0x7f000001"));
  await rejectsInvalidOrigin(origin.replace("127.0.0.1", "127.1"));
  await rejectsInvalidOrigin(origin + "/unexpected-path");
  // WHATWG URL silently resolves dot segments to the origin root. The smoke
  // gate must reject the literal path even when the parsed URL looks valid.
  for (const normalizedPath of ["/.", "/..", "/%2e", "/%2E", "/%2e%2e", "/a/..", "/a/%2e%2e"]) {
    await rejectsInvalidOrigin(origin + normalizedPath);
  }
  assert.equal(await run(origin + "/"), true, "A single optional trailing slash remains a valid origin");
  await rejectsInvalidOrigin(" " + origin);
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
  contentType = "application/json; boundary=unexpected";
  assert.equal(await run(), false, "Unexpected liveness media-type parameter must block promotion");
  contentType = "application/json; charset=utf-8; profile=unexpected";
  assert.equal(await run(), false, "Extra liveness media-type parameter must block promotion");
  contentType = "application/json;";
  assert.equal(await run(), false, "Empty liveness media-type parameter must block promotion");
  contentType = "application/json; charset=iso-8859-1";
  assert.equal(await run(), false, "Non-UTF-8 liveness charset must block promotion");
  contentType = "application/json; charset=utf-8; charset=latin1";
  assert.equal(await run(), false, "Conflicting liveness charsets must block promotion");
  contentType = "application/json; charset";
  assert.equal(await run(), false, "Malformed liveness charset must block promotion");
  contentType = "application/json";
  readyContentType = "application/json; profile=unexpected";
  assert.equal(await run(), false, "Unexpected readiness media-type parameter must block promotion");
  readyContentType = "application/json; charset=utf-8; boundary=unexpected";
  assert.equal(await run(), false, "Extra readiness media-type parameter must block promotion");
  readyContentType = 'application/json; charset="UTF-8"';
  assert.equal(await run(), true, "Quoted UTF-8 readiness charset must remain valid");
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
  cacheControl = "no-store,,private";
  assert.equal(await run(), false, "Empty liveness cache directive must block promotion");
  cacheControl = "no-store, ";
  assert.equal(await run(), false, "Trailing empty liveness cache directive must block promotion");
  cacheControl = "no-store, no-store=false";
  assert.equal(await run(), false, "Conflicting parameterized liveness no-store must block promotion");
  cacheControl = "no-store, no-store = false";
  assert.equal(await run(), false, "Whitespace cannot hide parameterized liveness no-store");
  cacheControl = "no-store, public";
  assert.equal(await run(), false, "Contradictory public liveness caching must block promotion");
  cacheControl = "no-store, public=true";
  assert.equal(await run(), false, "Parameterized public liveness caching must block promotion");
  cacheControl = "no-store, public = true";
  assert.equal(await run(), false, "Whitespace cannot hide parameterized public liveness caching");
  cacheControl = "public, NO-STORE";
  assert.equal(await run(), false, "Public liveness caching must fail regardless of directive order");
  cacheControl = "private, NO-STORE";
  assert.equal(await run(), true, "Case-insensitive no-store directive must pass");
  cacheControl = "no-store, s-maxage=60";
  assert.equal(await run(), false, "Positive shared-cache lifetime must block liveness promotion");
  cacheControl = "no-store, max-age";
  assert.equal(await run(), false, "Bare max-age must not pass liveness cache policy");
  cacheControl = "no-store, max-age; unexpected=1";
  assert.equal(await run(), false, "Malformed max-age parameters must block liveness promotion");
  cacheControl = "no-store, max-age=0";
  assert.equal(await run(), true, "Zero max-age alongside no-store must pass liveness");
  cacheControl = "no-store, immutable";
  assert.equal(await run(), false, "Immutable liveness caching must block promotion");
  cacheControl = "no-store, immutable=true";
  assert.equal(await run(), false, "Parameterized immutable liveness caching must block promotion");
  cacheControl = "no-store, immutable ; unexpected=1";
  assert.equal(await run(), false, "Malformed immutable liveness caching must block promotion");
  cacheControl = "no-store, must-understand";
  assert.equal(await run(), false, "Must-understand can override no-store and must block liveness promotion");
  cacheControl = "no-store, must-understand=true";
  assert.equal(await run(), false, "Parameterized must-understand must block liveness promotion");
  cacheControl = "no-store, stale-while-revalidate=30";
  assert.equal(await run(), false, "Stale-while-revalidate liveness caching must block promotion");
  cacheControl = "no-store, stale-if-error=30";
  assert.equal(await run(), false, "Stale-if-error liveness caching must block promotion");
  cacheControl = "no-store";
  readyCacheControl = "public, max-age=60";
  assert.equal(await run(), false, "Cacheable readiness must block promotion even when liveness is healthy");
  readyCacheControl = "no-store=false";
  assert.equal(await run(), false, "Misleading readiness cache directive must block promotion");
  readyCacheControl = "no-store,,private";
  assert.equal(await run(), false, "Empty readiness cache directive must block promotion");
  readyCacheControl = "no-store, ";
  assert.equal(await run(), false, "Trailing empty readiness cache directive must block promotion");
  readyCacheControl = "no-store, no-store=true";
  assert.equal(await run(), false, "Conflicting parameterized readiness no-store must block promotion");
  readyCacheControl = "no-store, no-store; unsafe=1";
  assert.equal(await run(), false, "Parameterized readiness no-store must fail closed");
  readyCacheControl = "no-store, public";
  assert.equal(await run(), false, "Contradictory public readiness caching must block promotion");
  readyCacheControl = "no-store, public=true";
  assert.equal(await run(), false, "Parameterized public readiness caching must block promotion");
  readyCacheControl = "no-store, max-age=60";
  assert.equal(await run(), false, "Positive readiness max-age must block promotion");
  readyCacheControl = "no-store, s-maxage=bogus";
  assert.equal(await run(), false, "Malformed readiness shared-cache lifetime must block promotion");
  readyCacheControl = "no-store, s-maxage";
  assert.equal(await run(), false, "Bare shared-cache lifetime must block readiness promotion");
  readyCacheControl = "no-store, s-maxage ; unexpected=1";
  assert.equal(await run(), false, "Malformed shared-cache lifetime parameters must block readiness promotion");
  readyCacheControl = "no-store, s-maxage=0";
  assert.equal(await run(), true, "Zero readiness shared-cache lifetime must pass");
  readyCacheControl = "no-store, immutable = true";
  assert.equal(await run(), false, "Whitespace cannot hide parameterized immutable readiness caching");
  readyCacheControl = "no-store, must-understand";
  assert.equal(await run(), false, "Must-understand must block readiness promotion");
  readyCacheControl = "no-store, must-understand ; mode=1";
  assert.equal(await run(), false, "Malformed must-understand must block readiness promotion");
  readyCacheControl = "no-store, stale-while-revalidate=30";
  assert.equal(await run(), false, "Stale-while-revalidate readiness caching must block promotion");
  readyCacheControl = "no-store, stale-if-error=30";
  assert.equal(await run(), false, "Stale-if-error readiness caching must block promotion");
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
  latencyMs = 1.5;
  assert.equal(await run(), false, "Fractional database latency cannot be emitted by the readiness route");
  latencyMs = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(await run(), false, "Unsafe database latency must block promotion");
  latencyMs = 5_001;
  assert.equal(await run(), false, "Database latency above the five-second smoke deadline must block promotion");
  latencyMs = 5_000;
  assert.equal(await run(), true, "Database latency at the five-second boundary remains valid");
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
