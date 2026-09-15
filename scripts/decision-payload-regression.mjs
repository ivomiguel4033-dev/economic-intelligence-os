import { spawn } from "node:child_process";
import process from "node:process";

const host = "127.0.0.1";
const port = 3252;
const baseUrl = `http://${host}:${port}`;
const maxBytes = 1_000_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForServer() {
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
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  }
}

const child = spawn("npm", ["run", "start", "--", "--hostname", host, "--port", String(port)], {
  env: {
    ...process.env,
    OIDC_ISSUER: "https://issuer.example.test",
    OIDC_AUDIENCE: "economic-intelligence-os",
    OIDC_JWKS_URL: "https://issuer.example.test/.well-known/jwks.json",
  },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });

try {
  await waitForServer();

  const declared = await fetch(`${baseUrl}/api/decisions`, {
    method: "POST",
    headers: { "content-length": String(maxBytes + 1) },
    body: "x",
  }).catch(() => null);
  if (declared) {
    assert(declared.status === 413, `Expected declared oversized decision payload 413, got ${declared.status}`);
    assert(declared.headers.get("cache-control") === "no-store", "Declared oversized decision response must disable caching");
  }

  const chunkSize = 64 * 1024;
  let sent = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (sent > maxBytes) {
        controller.close();
        return;
      }
      const remaining = maxBytes + 1 - sent;
      const size = Math.min(chunkSize, remaining);
      controller.enqueue(new Uint8Array(size).fill(120));
      sent += size;
    },
  });
  const streamed = await fetch(`${baseUrl}/api/decisions`, {
    method: "POST",
    body: stream,
    duplex: "half",
  });
  assert(streamed.status === 413, `Expected chunked oversized decision payload 413, got ${streamed.status}`);
  assert(streamed.headers.get("cache-control") === "no-store", "Chunked oversized decision response must disable caching");
  const streamedBody = await streamed.json();
  assert(streamedBody.error === "Decision request payload too large", "Oversized decision response must use the bounded-payload error");

  const malformed = await fetch(`${baseUrl}/api/decisions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not-json",
  });
  assert(malformed.status === 400, `Expected malformed decision payload 400, got ${malformed.status}`);
  assert(malformed.headers.get("cache-control") === "no-store", "Malformed decision response must disable caching");
  const malformedBody = await malformed.json();
  assert(malformedBody.error === "Invalid decision request", "Malformed decision payload must return a generic client-safe error");

  const unauthorized = await fetch(`${baseUrl}/api/decisions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId: "org_test", title: "Test", objective: "Test objective" }),
  });
  assert(unauthorized.status === 401, `Expected unauthenticated decision request 401, got ${unauthorized.status}`);
  assert(unauthorized.headers.get("cache-control") === "no-store", "Unauthenticated decision response must disable caching");
  assert(unauthorized.headers.get("www-authenticate") === "Bearer", "Unauthenticated decision response must advertise Bearer authentication");
  const unauthorizedBody = await unauthorized.json();
  assert(unauthorizedBody.error === "Authentication required", "Unauthenticated decision response must not expose internal authentication details");
} finally {
  await stopServer(child);
}

assert(!/UnhandledPromiseRejection/i.test(stderr), "Decision payload regression server emitted an unhandled rejection");
console.log("Decision payload bounds, cache controls and client-safe error regression checks passed");
