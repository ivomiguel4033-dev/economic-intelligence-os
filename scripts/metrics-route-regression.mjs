import { spawn } from "node:child_process";
import process from "node:process";

const host = "127.0.0.1";
let nextPort = 3210;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForServer(baseUrl) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${baseUrl}/api/metrics`);
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
    // The regression server is started as its own process group so npm and
    // the Next.js process it launches are terminated together. Killing only
    // npm leaves next-server orphaned and keeps CI alive after the test ends.
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

  assert(!/UnhandledPromiseRejection/i.test(stderr), "Metrics regression server emitted an unhandled rejection");
}

await withServer({ METRICS_TOKEN: "" }, async (baseUrl) => {
  const response = await fetch(`${baseUrl}/api/metrics`);
  assert(response.status === 503, `Expected 503 without METRICS_TOKEN, got ${response.status}`);
  assert((await response.text()) === "metrics unavailable\n", "Unexpected disabled metrics response body");
});

await withServer({ METRICS_TOKEN: "ci-metrics-token" }, async (baseUrl) => {
  const unauthorized = await fetch(`${baseUrl}/api/metrics`, {
    headers: { authorization: "Bearer wrong-token" },
  });
  assert(unauthorized.status === 401, `Expected 401 for invalid token, got ${unauthorized.status}`);

  const response = await fetch(`${baseUrl}/api/metrics`, {
    headers: { authorization: "Bearer ci-metrics-token" },
  });
  assert(response.status === 200, `Expected 200 for valid metrics request, got ${response.status}`);
  assert(response.headers.get("cache-control") === "no-store", "Metrics response must disable caching");
  assert(response.headers.get("content-type")?.includes("text/plain"), "Metrics response must be Prometheus text");
  const body = await response.text();
  assert(body.includes("http_requests_total "), "Counter metrics missing from authenticated response");
  assert(body.includes("outbox_ready "), "Operational outbox gauges missing while PostgreSQL is healthy");
});

await withServer(
  {
    METRICS_TOKEN: "ci-metrics-token",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:1/app_test",
  },
  async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/metrics`, {
      headers: { authorization: "Bearer ci-metrics-token" },
    });
    assert(response.status === 200, `Expected degraded metrics endpoint to remain 200, got ${response.status}`);
    const body = await response.text();
    assert(body.includes("http_requests_total "), "Counter metrics must remain available during database failure");
    assert(!body.includes("outbox_ready "), "Stale operational gauges must not be emitted when database snapshot fails");
  },
);

console.log("Metrics route regression checks passed");
