#!/usr/bin/env node
// Post-deploy gate: liveness is not sufficient without database readiness.
import process from "node:process";
import { TextDecoder } from "node:util";

const input = process.argv[2];
if (process.argv.length !== 3) {
  console.error("Usage: node scripts/production-smoke.mjs <https://service-origin>");
  process.exit(2);
}
try {
  // URL parsing silently removes tabs and newlines; reject the raw input.
  if (/[\u0000-\u001f\u007f]/.test(input) || input !== input.trim() || input.includes("\\")) {
    throw new Error("Origin must not contain whitespace, control characters or backslashes");
  }
  // WHATWG URL normalizes missing authority slashes and strips empty userinfo.
  // Check the literal origin before trusting the parsed hostname for promotion.
  const rawAuthority = /^https?:\/\/([^/?#]+)/i.exec(input)?.[1];
  if (!rawAuthority || rawAuthority.includes("@")) {
    throw new Error("Expected an HTTPS origin without credentials, path, query or fragment");
  }
  const origin = new URL(input);
  // Port zero is a bind-only sentinel, never a reachable deployment endpoint.
  // Fail during validation rather than treating a connection failure as smoke evidence.
  if (origin.port === "0") throw new Error("Deployment origin must not use port 0");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if ((origin.protocol !== "https:" && !(local && origin.protocol === "http:")) ||
      origin.username || origin.password || input.includes("?") || input.includes("#") || origin.search || origin.hash ||
      origin.pathname !== "/") {
    throw new Error("Expected an HTTPS origin without credentials, path, query or fragment");
  }
  async function check(path, status, dependency = false) {
    const response = await fetch(new URL(path, origin), {
      // Ask intermediaries for a fresh probe even if a cache is misconfigured.
      headers: {
        accept: "application/json",
        "cache-control": "no-store",
        pragma: "no-cache",
      },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (response.status !== 200) throw new Error(`${path} returned HTTP ${response.status}`);
    // Health probes must be stateless: a session cookie signals unintended auth middleware
    // or a proxy response that should never be used to approve a deployment.
    if (response.headers.has("set-cookie")) {
      throw new Error(`${path} unexpectedly set a cookie`);
    }
    // A 200 response carrying an authentication challenge or retry instruction is
    // not unambiguous evidence that this deployment can serve production traffic.
    for (const header of ["www-authenticate", "retry-after"]) {
      if (response.headers.has(header)) {
        throw new Error(`${path} unexpectedly returned ${header}`);
      }
    }
    // A 200 response must be complete; Content-Range suggests a partial or proxy-rewritten probe.
    if (response.headers.has("content-range")) {
      throw new Error(`${path} returned an unexpected partial response (content-range)`);
    }
    // Reject oversized or malformed declared bodies before consuming the stream.
    // The streaming cap below remains authoritative for missing or dishonest lengths.
    const maxResponseBytes = 64 * 1024;
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null &&
        (!/^[1-9][0-9]*$/.test(declaredLength) || Number(declaredLength) > maxResponseBytes)) {
      throw new Error(`${path} declared an invalid or oversized Content-Length`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    const [rawMediaType, ...parameters] = contentType.split(";");
    if (rawMediaType.trim().toLowerCase() !== "application/json") {
      throw new Error(`${path} did not return JSON`);
    }
    // JSON is UTF-8 on the wire; contradictory charset metadata must fail closed.
    // The deployment contract permits only one optional UTF-8 charset.
    // Reject unrelated, empty or duplicate parameters instead of ignoring them.
    if (parameters.length > 1 ||
        parameters.some((part) => !/^\s*charset\s*=\s*(?:"utf-8"|utf-8)\s*$/i.test(part))) {
      throw new Error(`${path} declared an invalid or unexpected JSON content-type parameter`);
    }
    const cacheDirectives = response.headers.get("cache-control")?.split(",")
      .map((directive) => directive.trim().toLowerCase()) ?? [];
    // Positive or malformed freshness lifetimes conflict with uncacheable health responses.
    // Immutable and must-understand can defeat no-store (must-understand permits
    // compliant caches to disregard no-store for understood status codes).
    const conflictingCaching = cacheDirectives.some((directive) =>
      /^(?:immutable|must-understand)(?=\s|=|;|$)/.test(directive) ||
      (/^(?:s-maxage|max-age)(?=\s|=|;|$)/.test(directive) &&
       !/^(?:s-maxage|max-age)\s*=\s*0$/.test(directive)));
    // Stale-serving extensions are incompatible with a fail-closed deployment health gate.
    const staleServing = cacheDirectives.some((directive) =>
      /^(?:stale-while-revalidate|stale-if-error)\b/.test(directive));
    // Contradictory or parameterized no-store directives can be interpreted
    // differently by intermediaries; never approve promotion on ambiguous policy.
    const malformedNoStore = cacheDirectives.some((directive) =>
      /^no-store(?:\s|=|;)/.test(directive) && directive !== "no-store");
    if (!cacheDirectives.includes("no-store") || cacheDirectives.some((directive) => /^public(?:\s|=|;|$)/.test(directive)) ||
        conflictingCaching || staleServing || malformedNoStore) {
      throw new Error(`${path} must disable caching`);
    }
    // CDN-specific policies can override general Cache-Control at intermediary caches.
    // Accept only an explicit no-store policy; contradictory directives fail closed.
    for (const header of ["cdn-cache-control", "surrogate-control"]) {
      const policy = response.headers.get(header);
      if (policy !== null && policy.trim().toLowerCase() !== "no-store") {
        throw new Error(`${path} must disable ${header} caching`);
      }
    }
    // A nonzero or malformed Age header means a proxy may have served stale health data.
    const age = response.headers.get("age");
    if (age !== null && age.trim() !== "0") {
      throw new Error(`${path} returned a cached or invalid Age header`);
    }
    // A stale or future HTTP Date can expose cached probes even when Age is zero.
    // Allow five minutes of clock skew but reject malformed or noncanonical dates.
    const responseDate = response.headers.get("date");
    if (responseDate !== null) {
      const issuedAt = Date.parse(responseDate);
      if (!Number.isFinite(issuedAt) ||
          new Date(issuedAt).toUTCString() !== responseDate.trim() ||
          Math.abs(Date.now() - issuedAt) > 5 * 60 * 1000) {
        throw new Error(`${path} returned a stale or invalid Date header`);
      }
    }
    // Expires can advertise cache freshness to an intermediary that ignores no-store.
    // Permit only expired dates or conventional explicit zero/negative sentinels.
    const expires = response.headers.get("expires");
    if (expires !== null && !["0", "-1"].includes(expires.trim())) {
      const expiry = Date.parse(expires);
      // Date.parse accepts non-HTTP dates such as "1" and mismatched weekdays.
      // Require the canonical IMF-fixdate representation for promotion evidence.
      if (!Number.isFinite(expiry) || new Date(expiry).toUTCString() !== expires.trim() || expiry > Date.now()) {
        throw new Error(`${path} returned a future or invalid Expires header`);
      }
    }
    // Legacy HTTP Warning 110/111/112 exposes stale or disconnected proxy responses.
    // A health probe must not promote an instance based on such cached evidence.
    const warning = response.headers.get("warning");
    if (warning !== null && /(?:^|,)\s*11[012](?=\s|$)/.test(warning)) {
      throw new Error(`${path} returned a stale or disconnected response (warning)`);
    }
    // A proxy may report a cache hit even when Age is zero or absent.
    const cacheSignals = [
      ["x-cache", /(?:^|[^a-z0-9])(?:hit|stale|updating|revalidated|tcp_(?:mem_|refresh_|ims_)?hit)(?=$|[^a-z0-9])/i],
      // Some CDNs and reverse proxies report the cache decision only here.
      ["x-proxy-cache", /(?:^|[^a-z0-9])(?:hit|stale|updating|revalidated|tcp_(?:mem_|refresh_|ims_)?hit)(?=$|[^a-z0-9])/i],
      // Nginx and other reverse proxies report cache hits in X-Cache-Status.
      ["x-cache-status", /(?:^|[^a-z0-9])(?:hit|stale|updating|revalidated)(?=$|[^a-z0-9])/i],
      ["cf-cache-status", /(?:^|,)\s*(?:hit|stale|updating|revalidated)\s*(?=,|$)/i],
    ];
    for (const [header, cached] of cacheSignals) {
      const value = response.headers.get(header);
      if (value !== null && cached.test(value.trim())) {
        throw new Error(`${path} returned a cached response (${header})`);
      }
    }
    // RFC 9211 Cache-Status uses a structured boolean: only hit=?0 proves a miss.
    // Bare hit means true; malformed hit values must fail closed during promotion.
    // Check comma-delimited members too: an invalid bare hit after a miss cannot be ignored.
    const cacheStatus = response.headers.get("cache-status");
    if (cacheStatus !== null) {
      for (const match of cacheStatus.matchAll(/(?:^|[;,])\s*hit(?=\s|=|;|,|$)([^;,]*)/gi)) {
        if (!/^\s*=\s*\?0\s*$/.test(match[1])) {
          throw new Error(`${path} returned a cached or invalid response (cache-status)`);
        }
      }
    }
    // Bound memory use when an unhealthy origin returns an oversized response.
    const chunks = [];
    let totalBytes = 0;
    if (!response.body) throw new Error(`${path} returned an empty response`);
    for await (const chunk of response.body) {
      totalBytes += chunk.byteLength;
      if (totalBytes > maxResponseBytes) {
        throw new Error(`${path} response exceeded ${maxResponseBytes} bytes`);
      }
      chunks.push(Buffer.from(chunk));
    }
    // Malformed UTF-8 must not be silently replaced in deployment health evidence.
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    // A proxy can refresh its HTTP Date while replaying an old JSON payload.
    // Require a fresh, canonical server-generated timestamp on both probes.
    const timestamp = body?.timestamp;
    const generatedAt = typeof timestamp === "string" ? Date.parse(timestamp) : NaN;
    if (typeof timestamp !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) ||
        !Number.isFinite(generatedAt) ||
        new Date(generatedAt).toISOString() !== timestamp ||
        Math.abs(Date.now() - generatedAt) > 5 * 60 * 1000) {
      throw new Error(`${path} returned a stale or invalid body timestamp`);
    }
    if (body.service !== "economic-intelligence-os" || body.status !== status) {
      throw new Error(`${path} returned an unexpected service or status`);
    }
    // The API measures database latency with Date.now() and the smoke request
    // has a five-second deadline. Fractional, unsafe or >5s values cannot
    // represent a healthy, fresh readiness probe and must not promote a release.
    const databaseLatencyMs = body.dependencies?.database?.latencyMs;
    if (dependency && (body.dependencies?.database?.status !== "ok" ||
        !Number.isSafeInteger(databaseLatencyMs) ||
        databaseLatencyMs < 0 || databaseLatencyMs > 5_000)) {
      throw new Error("/api/ready did not confirm database readiness");
    }
    if (!dependency && body.checks?.application !== "ok") {
      throw new Error("/api/health did not confirm application liveness");
    }
  }
  await check("/api/health", "ok");
  await check("/api/ready", "ready", true);
  console.log("Production smoke passed: liveness and database readiness");
} catch (error) {
  console.error(`Production smoke FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
