import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";

const host = "127.0.0.1";
let nextPort = 3230;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const readinessSource = await readFile(new URL("../src/app/api/ready/route.ts", import.meta.url), "utf8");
assert(
  /const pool = getDatabasePoolSnapshot\(\);[\s\S]*?if \(pool\.total >= pool\.max && pool\.idle === 0\)\s*\{[\s\S]*?return notReady\(["']database_pool_saturated["']\);?[\s\S]*?\}/.test(readinessSource),
  "Readiness must fail fast without querying PostgreSQL when the connection pool is saturated",
);
assert(
  readinessSource.indexOf("database_pool_saturated") < readinessSource.indexOf("await db.query"),
  "Pool saturation guard must execute before the database readiness probe",
);

async function waitForServer(baseUrl) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${baseUrl}/api/health`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Next server did not become ready: ${baseUrl}`);
}

function signalProcessTree(child, signal) {
  if (!child.pid) return;

  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function stopServer(child) {
  if (child.exitCode !== null) return;

  const exited = new Promise((resolve) => child.once("exit", resolve));
  signalProcessTree(child, "SIGTERM");

  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);

  if (!stopped) {
    signalProcessTree(child, "SIGKILL");
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
}

async function withServer(env, run) {
  const port = nextPort++;
  const baseUrl = `http://${host}:${port}`;
  const child = spawn(
    "npm",
    ["run", "start", "--", "--hostname", host, "--port", String(port)],
    {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForServer(baseUrl);
    await run(baseUrl);
  } finally {
    await stopServer(child);
  }

  assert(!/UnhandledPromiseRejection/i.test(stderr), "Health regression server emitted an unhandled rejection");
}

await withServer({}, async (baseUrl) => {
  const health = await fetch(`${baseUrl}/api/health`);
  assert(health.status === 200, `Expected liveness 200, got ${health.status}`);
  assert(health.headers.get("cache-control") === "no-store", "Liveness response must disable caching");
  const healthBody = await health.json();
  assert(healthBody.status === "ok", "Liveness status must be ok");
  assert(healthBody.checks?.application === "ok", "Application liveness check missing");

  const ready = await fetch(`${baseUrl}/api/ready`);
  assert(ready.status === 200, `Expected readiness 200 with healthy database, got ${ready.status}`);
  assert(ready.headers.get("cache-control") === "no-store", "Readiness response must disable caching");
  const readyBody = await ready.json();
  assert(readyBody.status === "ready", "Readiness status must be ready");
  assert(readyBody.dependencies?.database?.status === "ok", "Database readiness status missing");
  assert(Number.isFinite(readyBody.dependencies.database.latencyMs), "Database readiness latency missing");
});

await withServer(
  { DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:1/app_test" },
  async (baseUrl) => {
    const health = await fetch(`${baseUrl}/api/health`);
    assert(health.status === 200, `Liveness must remain 200 during database outage, got ${health.status}`);
    const healthBody = await health.json();
    assert(healthBody.status === "ok", "Application must remain live when a dependency is unavailable");

    const ready = await fetch(`${baseUrl}/api/ready`);
    assert(ready.status === 503, `Expected readiness 503 during database outage, got ${ready.status}`);
    assert(ready.headers.get("cache-control") === "no-store", "Degraded readiness response must disable caching");
    assert(ready.headers.get("retry-after") === "1", "Degraded readiness response must advertise retry timing");
    const readyBody = await ready.json();
    assert(readyBody.status === "not_ready", "Degraded readiness status must be not_ready");
    assert(readyBody.dependencies?.database?.status === "unavailable", "Database outage must be explicit in readiness");
    assert(!("error" in readyBody), "Readiness response must not expose internal error details");
  },
);

console.log("Health and readiness route regression checks passed");
