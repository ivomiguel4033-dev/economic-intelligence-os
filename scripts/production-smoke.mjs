#!/usr/bin/env node
// Post-deploy gate: liveness is not sufficient without database readiness.
import process from "node:process";

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
    const mediaType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (mediaType !== "application/json") {
      throw new Error(`${path} did not return JSON`);
    }
    const cacheDirectives = response.headers.get("cache-control")?.split(",")
      .map((directive) => directive.trim().toLowerCase()) ?? [];
    if (!cacheDirectives.includes("no-store")) {
      throw new Error(`${path} must disable caching`);
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
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
