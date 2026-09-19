import { spawn } from "node:child_process";
import net from "node:net";
import { readFile } from "node:fs/promises";
import process from "node:process";

const host = "127.0.0.1";
let nextPort = 3230;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSecurityHeaders(response, label) {
  const expected = new Map([
    ["x-content-type-options", "nosniff"],
    ["x-frame-options", "DENY"],
    ["referrer-policy", "strict-origin-when-cross-origin"],
    ["permissions-policy", "camera=(), microphone=(), geolocation=()"],
    ["cross-origin-opener-policy", "same-origin"],
    ["cross-origin-resource-policy", "same-origin"],
    ["x-dns-prefetch-control", "off"],
    ["strict-transport-security", "max-age=31536000"],
    ["origin-agent-cluster", "?1"],
    ["x-permitted-cross-domain-policies", "none"],
  ]);

  for (const [header, value] of expected) {
    assert(response.headers.get(header) === value, `${label} must preserve ${header}: ${value}`);
  }

  assert(response.headers.get("x-powered-by") === null, `${label} must not expose X-Powered-By`);
}

const readinessSource = await readFile(new URL("../src/app/api/ready/route.ts", import.meta.url), "utf8");
assert(
  /const pool = getDatabasePoolSnapshot\(\);[\s\S]*?if \(pool\.waiting > 0 \|\| \(pool\.total >= pool\.max && pool\.idle === 0\)\)\s*\{[\s\S]*?return notReady\(["']database_pool_saturated["']\);?[\s\S]*?\}/.test(readinessSource),
  "Readiness must fail fast without querying PostgreSQL when the connection pool is saturated or already has queued work",
);
const databaseProbeIndex = readinessSource.indexOf("client = await connectForReadiness()");
assert(databaseProbeIndex !== -1, "Readiness must acquire a dedicated PostgreSQL client through its bounded connection probe");
assert(
  readinessSource.indexOf("database_pool_saturated") < databaseProbeIndex,
  "Pool saturation guard must execute before the database readiness probe",
);
assert(
  /const readinessConnectionTimeoutMs = 1_000;/.test(readinessSource) &&
    /const connection = db\.connect\(\);[\s\S]*?Promise\.race\(\[[\s\S]*?connection,[\s\S]*?readinessConnectionTimeoutMs[\s\S]*?\]\)/.test(readinessSource),
  "Readiness PostgreSQL connection acquisition must remain independently bounded to one second",
);
assert(
  /if \(timedOut\) \{[\s\S]*?void connection[\s\S]*?\.then\(\(lateClient\) => lateClient\.release\(\)\)[\s\S]*?\.catch\(\(\) => undefined\);[\s\S]*?\}/.test(readinessSource),
  "A PostgreSQL session delivered after readiness times out must be released immediately without creating an unhandled rejection",
);
assert(
  /const readinessQueryTimeoutMs = 2_000;/.test(readinessSource) &&
    /async function queryForReadiness[\s\S]*?const query = client\.query\(text\);[\s\S]*?Promise\.race\(\[[\s\S]*?query,[\s\S]*?readinessQueryTimeoutMs[\s\S]*?\]\)/.test(readinessSource),
  "Every PostgreSQL readiness statement must have an independent query-phase deadline",
);
assert(
  /if \(timedOut\) \{[\s\S]*?client\.release\(true\);[\s\S]*?void query\.catch\(\(\) => undefined\);[\s\S]*?\}/.test(readinessSource),
  "A timed-out readiness query must destroy its session and absorb the abandoned query rejection",
);
assert(
  /await queryForReadiness\(client, ["']BEGIN["']\)/.test(readinessSource) &&
    /await queryForReadiness\(client, `SET LOCAL statement_timeout = '\$\{readinessStatementTimeoutMs\}ms'`\)/.test(readinessSource) &&
    /await queryForReadiness\(client, ["']SELECT 1["']\)/.test(readinessSource) &&
    /await queryForReadiness\(client, ["']COMMIT["']\)/.test(readinessSource),
  "Readiness must keep every dependency-probe statement inside its bounded query wrapper",
);
assert(
  /else if \(client && transactionStarted\)[\s\S]*?await queryForReadiness\(client, ["']ROLLBACK["']\)/.test(readinessSource),
  "Readiness must rollback a started transaction after a recoverable probe failure",
);
assert(
  /error instanceof ReadinessQueryTimeoutError[\s\S]*?client = undefined;[\s\S]*?transactionStarted = false;/.test(readinessSource),
  "A timed-out readiness query must not reuse or rollback a session already destroyed by the timeout guard",
);
assert(
  /catch \{[\s\S]*?client\.release\(true\);[\s\S]*?client = undefined;[\s\S]*?\}/.test(readinessSource),
  "Readiness must destroy a client whose rollback fails instead of returning it to the pool",
);
assert(
  /finally \{[\s\S]*?client\?\.release\(\);[\s\S]*?\}/.test(readinessSource),
  "Readiness must release a recoverable dedicated client on every exit path",
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

async function withStalledDatabase(run) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    // Intentionally accept the TCP connection and never answer the PostgreSQL
    // startup handshake. This exercises the readiness acquisition deadline
    // rather than the much easier immediate ECONNREFUSED path.
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  assert(address && typeof address !== "string", "Stalled database server did not expose a TCP port");

  try {
    await run(address.port);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

await withServer({}, async (baseUrl) => {
  const health = await fetch(`${baseUrl}/api/health`);
  assert(health.status === 200, `Expected liveness 200, got ${health.status}`);
  assertSecurityHeaders(health, "Liveness response");
  assert(health.headers.get("cache-control") === "no-store", "Liveness response must disable caching");
  const healthBody = await health.json();
  assert(healthBody.status === "ok", "Liveness status must be ok");
  assert(healthBody.checks?.application === "ok", "Application liveness check missing");

  const ready = await fetch(`${baseUrl}/api/ready`);
  assert(ready.status === 200, `Expected readiness 200 with healthy database, got ${ready.status}`);
  assertSecurityHeaders(ready, "Readiness response");
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
    assertSecurityHeaders(health, "Degraded liveness response");
    const healthBody = await health.json();
    assert(healthBody.status === "ok", "Application must remain live when a dependency is unavailable");

    const ready = await fetch(`${baseUrl}/api/ready`);
    assert(ready.status === 503, `Expected readiness 503 during database outage, got ${ready.status}`);
    assertSecurityHeaders(ready, "Degraded readiness response");
    assert(ready.headers.get("cache-control") === "no-store", "Degraded readiness response must disable caching");
    assert(ready.headers.get("retry-after") === "1", "Degraded readiness response must advertise retry timing");
    const readyBody = await ready.json();
    assert(readyBody.status === "not_ready", "Degraded readiness status must be not_ready");
    assert(readyBody.dependencies?.database?.status === "unavailable", "Database outage must be explicit in readiness");
    assert(!("error" in readyBody), "Readiness response must not expose internal error details");
  },
);

await withStalledDatabase(async (databasePort) => {
  await withServer(
    { DATABASE_URL: `postgresql://postgres:postgres@${host}:${databasePort}/app_test` },
    async (baseUrl) => {
      const started = Date.now();
      const ready = await fetch(`${baseUrl}/api/ready`);
      const elapsedMs = Date.now() - started;

      assert(ready.status === 503, `Expected readiness 503 for a stalled database handshake, got ${ready.status}`);
      assertSecurityHeaders(ready, "Stalled database readiness response");
      assert(
        elapsedMs < 2_500,
        `Readiness must abandon a stalled PostgreSQL connection promptly; response took ${elapsedMs}ms`,
      );
      assert(ready.headers.get("retry-after") === "1", "Stalled database readiness must advertise retry timing");
      const readyBody = await ready.json();
      assert(readyBody.status === "not_ready", "Stalled database readiness status must be not_ready");
      assert(
        readyBody.dependencies?.database?.status === "unavailable",
        "Stalled database handshake must be reported as an unavailable dependency",
      );
    },
  );
});

console.log("Health and readiness route regression checks passed");
