#!/usr/bin/env node
// Post-deploy gate: liveness is not sufficient without database readiness.
import process from "node:process";

const input = process.argv[2];
if (process.argv.length !== 3) {
  console.error("Usage: node scripts/production-smoke.mjs <https://service-origin>");
  process.exit(2);
}
try {
  const origin = new URL(input);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if ((origin.protocol !== "https:" && !(local && origin.protocol === "http:")) ||
      origin.username || origin.password || origin.search || origin.hash ||
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
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new Error(`${path} did not return JSON`);
    }
    if (!response.headers.get("cache-control")?.includes("no-store")) {
      throw new Error(`${path} must disable caching`);
    }
    const body = await response.json();
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
