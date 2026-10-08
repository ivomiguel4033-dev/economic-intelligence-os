import { spawn } from "node:child_process";
import process from "node:process";

const host = "127.0.0.1";
const port = 3250;
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

  const declared = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": String(maxBytes + 1) },
    body: "x",
  }).catch(() => null);
  if (declared) {
    assert(declared.status === 413, `Expected declared oversized orchestration payload 413, got ${declared.status}`);
    assert(declared.headers.get("cache-control") === "no-store", "Declared oversized orchestration response must disable caching");
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
  const streamed = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  });
  assert(streamed.status === 413, `Expected chunked oversized orchestration payload 413, got ${streamed.status}`);
  assert(streamed.headers.get("cache-control") === "no-store", "Chunked oversized orchestration response must disable caching");
  const streamedBody = await streamed.json();
  assert(streamedBody.error === "Orchestration request payload too large", "Oversized orchestration response must use the bounded-payload error");

  const unsupportedOversized = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: {
      "content-type": "text/plain",
      "content-length": String(maxBytes + 1),
    },
    body: "x",
  }).catch(() => null);
  if (unsupportedOversized) {
    assert(unsupportedOversized.status === 415, `Expected unsupported declared oversized orchestration media type 415, got ${unsupportedOversized.status}`);
    assert(unsupportedOversized.headers.get("cache-control") === "no-store", "Unsupported declared oversized orchestration response must disable caching");
  }

  const unsupportedEncoding = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-encoding": "gzip",
    },
    body: JSON.stringify({ organizationId: "org_test", decisionId: "decision_test" }),
  });
  assert(unsupportedEncoding.status === 415, `Expected compressed orchestration payload 415, got ${unsupportedEncoding.status}`);
  assert(unsupportedEncoding.headers.get("cache-control") === "no-store", "Unsupported orchestration content encoding response must disable caching");
  const unsupportedEncodingBody = await unsupportedEncoding.json();
  assert(unsupportedEncodingBody.error === "Unsupported content encoding", "Unsupported orchestration content encoding must return a client-safe error");

  const unsupported = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ organizationId: "org_test", decisionId: "decision_test" }),
  });
  assert(unsupported.status === 415, `Expected unsupported orchestration media type 415, got ${unsupported.status}`);
  assert(unsupported.headers.get("cache-control") === "no-store", "Unsupported orchestration media type response must disable caching");
  const unsupportedBody = await unsupported.json();
  assert(unsupportedBody.error === "Unsupported media type", "Unsupported orchestration media type must return a generic client-safe error");

  const invalidOrganization = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId: 42, decisionId: "decision_test" }),
  });
  assert(invalidOrganization.status === 400, `Expected non-string orchestration organizationId 400, got ${invalidOrganization.status}`);
  assert((await invalidOrganization.json()).error === "Invalid orchestration request", "Invalid orchestration organizationId must fail before tenant resolution");

  const invalidDecisionId = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId: "org_test", decisionId: { value: "decision_test" } }),
  });
  assert(invalidDecisionId.status === 400, `Expected non-string orchestration decisionId 400, got ${invalidDecisionId.status}`);
  assert((await invalidDecisionId.json()).error === "Invalid orchestration request", "Invalid orchestration decisionId must fail before authentication");

  const emptyDecisionId = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId: "org_test", decisionId: "   " }),
  });
  assert(emptyDecisionId.status === 400, `Expected blank orchestration decisionId 400, got ${emptyDecisionId.status}`);
  assert((await emptyDecisionId.json()).error === "Invalid orchestration request", "Blank orchestration decisionId must fail before authentication");

  const nonCanonicalDecisionId = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId: "org_test", decisionId: " decision_test " }),
  });
  assert(nonCanonicalDecisionId.status === 400, `Expected non-canonical orchestration decisionId 400, got ${nonCanonicalDecisionId.status}`);
  assert((await nonCanonicalDecisionId.json()).error === "Invalid orchestration request", "Non-canonical orchestration decisionId must fail before authentication");

  const controlCharacterDecisionId = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId: "org_test", decisionId: `decision${String.fromCharCode(0)}test` }),
  });
  assert(controlCharacterDecisionId.status === 400, `Expected control-character orchestration decisionId 400, got ${controlCharacterDecisionId.status}`);
  assert((await controlCharacterDecisionId.json()).error === "Invalid orchestration request", "Control-character orchestration decisionId must fail before authentication");

  const oversizedDecisionId = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId: "org_test", decisionId: "d".repeat(257) }),
  });
  assert(oversizedDecisionId.status === 400, `Expected oversized orchestration decisionId 400, got ${oversizedDecisionId.status}`);
  assert((await oversizedDecisionId.json()).error === "Invalid orchestration request", "Oversized orchestration decisionId must fail before authentication");

  const invalidAction = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId: "org_test", decisionId: "decision_test", action: [] }),
  });
  assert(invalidAction.status === 400, `Expected non-object orchestration action 400, got ${invalidAction.status}`);
  assert((await invalidAction.json()).error === "Invalid orchestration request", "Invalid orchestration action must fail before authentication");

  const invalidActionTypes = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organizationId: "org_test",
      decisionId: "decision_test",
      action: { confidence: "0.9", externalSideEffect: "false" },
    }),
  });
  assert(invalidActionTypes.status === 400, `Expected invalid orchestration action field types 400, got ${invalidActionTypes.status}`);
  assert((await invalidActionTypes.json()).error === "Invalid orchestration request", "Invalid orchestration action field types must fail before authentication");

  for (const [description, actionType] of [
    ["non-canonical", " analysis "],
    ["control-character", `anal${String.fromCharCode(0)}ysis`],
  ]) {
    const response = await fetch(`${baseUrl}/api/orchestrate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: "org_test",
        decisionId: "decision_test",
        action: { actionType },
      }),
    });
    assert(response.status === 400, `Expected ${description} actionType 400 before authentication, got ${response.status}`);
    assert(response.headers.get("cache-control") === "no-store", `${description} actionType error must disable caching`);
    assert((await response.json()).error === "Invalid orchestration request", `${description} actionType must return a generic validation error`);
  }

  const invalidActionValues = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId: "org_test", decisionId: "decision_test", action: { riskTier: "extreme", confidence: 1.1, evidenceCount: -1 } }),
  });
  assert(invalidActionValues.status === 400, `Expected out-of-range orchestration action values 400, got ${invalidActionValues.status}`);
  assert((await invalidActionValues.json()).error === "Invalid orchestration request", "Out-of-range orchestration action values must fail before authentication");

  const invalidClaims = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organizationId: "org_test",
      decisionId: "decision_test",
      claims: [{ claim: "test", evidence: null, confidence: 0.5, status: "insufficient" }],
    }),
  });
  assert(invalidClaims.status === 400, `Expected malformed orchestration claims 400, got ${invalidClaims.status}`);
  assert((await invalidClaims.json()).error === "Invalid orchestration request", "Malformed orchestration claims must fail before authentication");

  const invalidClaimFields = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organizationId: "org_test",
      decisionId: "decision_test",
      claims: [{ claim: "test", evidence: [{ sourceId: "", title: "source" }], confidence: 1.5, status: "unknown" }],
    }),
  });
  assert(invalidClaimFields.status === 400, `Expected invalid orchestration claim fields 400, got ${invalidClaimFields.status}`);
  assert((await invalidClaimFields.json()).error === "Invalid orchestration request", "Invalid orchestration claim fields must fail before authentication");

  const excessiveClaims = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organizationId: "org_test",
      decisionId: "decision_test",
      claims: Array.from({ length: 257 }, (_, index) => ({ claim: `claim-${index}`, evidence: [], confidence: 0.5, status: "insufficient" })),
    }),
  });
  assert(excessiveClaims.status === 400, `Expected excessive orchestration claims 400, got ${excessiveClaims.status}`);
  assert((await excessiveClaims.json()).error === "Invalid orchestration request", "Excessive orchestration claims must fail before authentication");

  const excessiveEvidence = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organizationId: "org_test",
      decisionId: "decision_test",
      claims: [{ claim: "test", confidence: 0.5, status: "supported", evidence: Array.from({ length: 257 }, (_, index) => ({ sourceId: `source-${index}`, title: "source" })) }],
    }),
  });
  assert(excessiveEvidence.status === 400, `Expected excessive orchestration evidence 400, got ${excessiveEvidence.status}`);
  assert((await excessiveEvidence.json()).error === "Invalid orchestration request", "Excessive orchestration evidence must fail before authentication");

  const malformed = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not-json",
  });
  assert(malformed.status === 400, `Expected malformed orchestration payload 400, got ${malformed.status}`);
  assert(malformed.headers.get("cache-control") === "no-store", "Malformed orchestration response must disable caching");
  const malformedBody = await malformed.json();
  assert(malformedBody.error === "Invalid orchestration request", "Malformed orchestration payload must return a generic client-safe error");

  const suffixJson = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: { "content-type": "application/vnd.eios.request+json; charset=utf-8" },
    body: JSON.stringify({ organizationId: "org_test", decisionId: "decision_test" }),
  });
  assert(suffixJson.status === 401, `Expected application/*+json orchestration request to reach authentication, got ${suffixJson.status}`);
  assert(suffixJson.headers.get("www-authenticate") === "Bearer", "Structured-suffix JSON request must reach Bearer authentication");

  const unauthorized = await fetch(`${baseUrl}/api/orchestrate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId: "org_test", decisionId: "decision_test" }),
  });
  assert(unauthorized.status === 401, `Expected unauthenticated orchestration request 401, got ${unauthorized.status}`);
  assert(unauthorized.headers.get("cache-control") === "no-store", "Unauthenticated orchestration response must disable caching");
  assert(unauthorized.headers.get("www-authenticate") === "Bearer", "Unauthenticated orchestration response must advertise Bearer authentication");
  const unauthorizedBody = await unauthorized.json();
  assert(unauthorizedBody.error === "Authentication required", "Unauthenticated orchestration response must not expose internal authentication details");
} finally {
  await stopServer(child);
}

assert(!/UnhandledPromiseRejection/i.test(stderr), "Orchestration payload regression server emitted an unhandled rejection");
console.log("Orchestration payload bounds, media type, cache controls and client-safe error regression checks passed");
