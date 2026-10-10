import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const script = fileURLToPath(new URL("./production-smoke.mjs", import.meta.url));
let healthStatus = 200;
let readyStatus = 200;
const server = createServer((request, response) => {
  const health = request.url === "/api/health";
  response.writeHead(health ? healthStatus : readyStatus, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(health
    ? { status: "ok", service: "economic-intelligence-os", checks: { application: "ok" } }
    : { status: "ready", service: "economic-intelligence-os", dependencies: { database: { status: "ok", latencyMs: 1 } } }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
async function run() {
  try {
    await exec(process.execPath, [script, origin], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}
try {
  assert.equal(await run(), true, "Healthy deployment must pass");
  readyStatus = 503;
  assert.equal(await run(), false, "Database outage must block promotion");
  readyStatus = 200;
  healthStatus = 503;
  assert.equal(await run(), false, "Liveness failure must block promotion");
  console.log("Post-deploy smoke probe regression checks passed");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
