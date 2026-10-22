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
      headers: { accept: "application/json" },
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
    if (!cacheDirectives.includes("no-store") || cacheDirectives.includes("public")) {
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
    // A proxy may report a cache hit even when Age is zero or absent.
    const cacheSignals = [
      ["x-cache", /(?:^|[^a-z0-9])(?:hit|tcp_(?:mem_|refresh_|ims_)?hit)(?=$|[^a-z0-9])/i],
      ["cf-cache-status", /(?:^|,)\s*(?:hit|stale|updating|revalidated)\s*(?=,|$)/i],
    ];
    for (const [header, cached] of cacheSignals) {
      const value = response.headers.get(header);
      if (value !== null && cached.test(value.trim())) {
        throw new Error(`${path} returned a cached response (${header})`);
      }
    }
    // RFC 9211 Cache-Status exposes cache hits even when Age and vendor headers are absent.
    const cacheStatus = response.headers.get("cache-status");
    if (cacheStatus !== null && /;\s*hit(?:\s*=\s*\?1)?\s*(?=;|,|$)/i.test(cacheStatus)) {
      throw new Error(`${path} returned a cached response (cache-status)`);
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
