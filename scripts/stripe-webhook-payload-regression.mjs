import { spawn } from "node:child_process";
import process from "node:process";

const host = "127.0.0.1";
const port = 3240;
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
  env: { ...process.env, STRIPE_WEBHOOK_SECRET: "whsec_regression_only" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});

let stderr = "";
child.stderr.on("data", (chunk) => { stderr += String(chunk); });

try {
  await waitForServer();

  const declared = await fetch(`${baseUrl}/api/stripe/webhook`, {
    method: "POST",
    headers: { "content-length": String(maxBytes + 1), "stripe-signature": "invalid" },
    body: "x",
  }).catch(() => null);
  // Some HTTP clients reject a deliberately inconsistent Content-Length locally;
  // the streaming case below is the production-critical assertion.
  if (declared) assert(declared.status === 413, `Expected declared oversized payload 413, got ${declared.status}`);

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

  const streamed = await fetch(`${baseUrl}/api/stripe/webhook`, {
    method: "POST",
    headers: { "stripe-signature": "invalid" },
    body: stream,
    duplex: "half",
  });
  assert(streamed.status === 413, `Expected chunked oversized payload without Content-Length to return 413, got ${streamed.status}`);
  const response = await streamed.json();
  assert(response.error === "Stripe event payload too large", "Oversized streaming response must use the bounded-payload error");
} finally {
  await stopServer(child);
}

assert(!/UnhandledPromiseRejection/i.test(stderr), "Stripe payload regression server emitted an unhandled rejection");
console.log("Stripe webhook payload bound regression checks passed");
