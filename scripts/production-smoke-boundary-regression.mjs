// Independent byte-exact regression for the post-deploy smoke response cap.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const smoke = fileURLToPath(new URL("./production-smoke.mjs", import.meta.url));
const limit = 65_536;
const targets = { "/api/health": 0, "/api/ready": 0 };
let multibytePadding = false;
let gzipResponse = false;
const server = createServer((request, response) => {
  const path = request.url;
  if (!(path in targets)) {
    response.writeHead(404);
    response.end();
    return;
  }
  const health = path === "/api/health";
  const body = health
    ? { service: "economic-intelligence-os", status: "ok", checks: { application: "ok" }, padding: "" }
    : { service: "economic-intelligence-os", status: "ready", dependencies: { database: { status: "ok", latencyMs: 1 } }, padding: "" };
  const baseBytes = Buffer.byteLength(JSON.stringify(body));
  const paddingBytes = Math.max(0, targets[path] - baseBytes);
  body.padding = multibytePadding
    ? "é".repeat(Math.floor(paddingBytes / 2)) + "x".repeat(paddingBytes % 2)
    : "x".repeat(paddingBytes);
  response.writeHead(200, {
    "content-type": "application/json",
    "cache-control": "no-store",
    ...(gzipResponse ? { "content-encoding": "gzip" } : {}),
  });
  const json = JSON.stringify(body);
  response.end(gzipResponse ? gzipSync(json) : json);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
async function probe(expectOversize) {
  try {
    await exec(process.execPath, [smoke, origin], { timeout: 10_000 });
    assert.equal(expectOversize, false, "Oversized response unexpectedly passed");
  } catch (error) {
    if (!expectOversize) throw error;
    assert.match(String(error.stderr), /response exceeded 65536 bytes/);
  }
}
try {
  for (const path of Object.keys(targets)) {
    targets[path] = limit - 1;
    await probe(false);
    targets[path] = limit;
    await probe(false);
    targets[path] = limit + 1;
    await probe(true);
    targets[path] = 0;
  }
  // Verify the cap counts UTF-8 bytes rather than JavaScript characters.
  multibytePadding = true;
  for (const path of Object.keys(targets)) {
    targets[path] = limit - 1;
    await probe(false);
    targets[path] = limit;
    await probe(false);
    targets[path] = limit + 1;
    await probe(true);
    targets[path] = 0;
  }
  // Fetch transparently decompresses gzip; enforce the limit on decoded bytes,
  // not on the much smaller compressed transfer size.
  gzipResponse = true;
  multibytePadding = false;
  for (const path of Object.keys(targets)) {
    targets[path] = limit;
    await probe(false);
    targets[path] = limit + 1;
    await probe(true);
    targets[path] = 0;
  }
  // Also enforce the decoded byte cap when gzip carries multibyte UTF-8 JSON.
  multibytePadding = true;
  for (const path of Object.keys(targets)) {
    for (const size of [limit - 1, limit, limit + 1]) {
      targets[path] = size;
      await probe(size > limit);
    }
    targets[path] = 0;
  }
  console.log("Exact 64 KiB ASCII, UTF-8, gzip and gzip UTF-8 smoke boundaries passed");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
