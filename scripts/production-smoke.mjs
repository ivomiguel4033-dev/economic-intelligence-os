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
  const origin = new URL(input);
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
    const contentType = response.headers.get("content-type") ?? "";
    const [rawMediaType, ...parameters] = contentType.split(";");
    if (rawMediaType.trim().toLowerCase() !== "application/json") {
      throw new Error(`${path} did not return JSON`);
    }
    // JSON is UTF-8 on the wire; contradictory charset metadata must fail closed.
    const charsets = parameters.filter((part) => /^\s*charset(?:\s|=|$)/i.test(part));
    if (charsets.length > 1 ||
        charsets.some((part) => !/^\s*charset\s*=\s*(?:"utf-8"|utf-8)\s*$/i.test(part))) {
      throw new Error(`${path} declared an invalid or conflicting JSON charset`);
    }
    const cacheDirectives = response.headers.get("cache-control")?.split(",")
      .map((directive) => directive.trim().toLowerCase()) ?? [];
    // Positive, bare or malformed freshness lifetimes conflict with an uncacheable health response.
    // A zero lifetime is allowed for compatibility with no-store, but immutable is not.
    const conflictingFreshness = cacheDirectives.some((directive) =>
      /^immutable(?=\s|=|;|$)/.test(directive) ||
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
        conflictingFreshness || staleServing || malformedNoStore) {
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
    // Legacy HTTP Warning 110/111/112 exposes stale or disconnected proxy responses.
    // A health probe must not promote an instance based on such cached evidence.
    const warning = response.headers.get("warning");
    if (warning !== null && /(?:^|,)\s*11[012](?=\s|$)/.test(warning)) {
      throw new Error(`${path} returned a stale or disconnected response (warning)`);
    }
    // A proxy may report a cache hit even when Age is zero or absent.
    const cacheSignals = [
      ["x-cache", /(?:^|[^a-z0-9])(?:hit|stale|updating|revalidated|tcp_(?:mem_|refresh_|ims_)?hit)(?=$|[^a-z0-9])/i],
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
    const maxResponseBytes = 64 * 1024;
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
    if (body.service !== "economic-intelligence-os" || body.status !== status) {
      throw new Error(`${path} returned an unexpected service or status`);
    }
    if (dependency && (body.dependencies?.database?.status !== "ok" ||
        !Number.isFinite(body.dependencies.database.latencyMs) ||
        body.dependencies.database.latencyMs < 0)) {
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
