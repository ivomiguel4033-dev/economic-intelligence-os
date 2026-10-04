import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertSafeProviderAddress, assertSafeProviderUrl } from "../src/security/provider-url-policy.ts";

const source = await readFile(new URL("../src/ai/failover-provider.ts", import.meta.url), "utf8");
const providerSource = await readFile(new URL("../src/ai/providers/openai-compatible-provider.ts", import.meta.url), "utf8");
const modelProviderSource = await readFile(new URL("../src/ai/model-provider.ts", import.meta.url), "utf8");
const transportSource = await readFile(new URL("../src/http/pinned-https-transport.ts", import.meta.url), "utf8");
const providerUrlPolicySource = await readFile(new URL("../src/security/provider-url-policy.ts", import.meta.url), "utf8");
const telemetrySource = await readFile(new URL("../src/ai/providers/telemetry-provider.ts", import.meta.url), "utf8");

assert.match(source, /const DEFAULT_TIMEOUT_MS = 30_000;/, "failover must retain a bounded default timeout");
assert.match(source, /Number\.isSafeInteger\(timeoutMs\)/, "timeout must reject non-safe integers");
assert.match(source, /timeoutMs <= 0/, "timeout must reject zero and negative values");
assert.match(source, /At least one AI provider is required/, "failover must reject an empty provider chain");
assert.match(modelProviderSource, /signal\?: AbortSignal;/, "model requests must support cooperative cancellation");
assert.match(source, /const attemptController = new AbortController\(\);/, "failover must create a cancellation boundary for each provider attempt");
assert.match(source, /attemptController\.abort\(timeoutError\);[\s\S]*?reject\(timeoutError\);/, "provider timeout must abort the in-flight provider attempt before failover");
assert.match(source, /provider\.generate\(\{ \.\.\.request, signal: attemptController\.signal \}\)/, "failover must pass its attempt cancellation signal into the provider");
assert.match(source, /Promise\.race\(\[[\s\S]*?provider\.generate\([\s\S]*?timeoutPromise,[\s\S]*?callerAbortPromise,[\s\S]*?\]\)/, "each provider attempt must race provider completion, timeout and caller cancellation");
assert.match(source, /if \(request\.signal\?\.aborted\)[\s\S]*?throw request\.signal\.reason \?\? new Error\("AI request aborted"\)/, "failover must stop immediately when the caller is already cancelled");
assert.match(source, /request\.signal\.addEventListener\("abort", callerAbortHandler, \{ once: true \}\)/, "failover must propagate caller cancellation into the active attempt");
assert.match(source, /request\.signal\.removeEventListener\("abort", callerAbortHandler\)/, "failover must clean up caller cancellation listeners");
assert.match(source, /finally\s*\{[\s\S]*?clearTimeout\(timeout\);[\s\S]*?\}/, "provider timers must be cleared on every settled attempt");

const catchIndex = source.indexOf("} catch (error) {");
const finallyIndex = source.indexOf("} finally {");
const loopIndex = source.indexOf("for (const provider of this.providers)");
assert.ok(loopIndex >= 0 && catchIndex > loopIndex, "provider failures must be handled inside the failover loop");
assert.ok(finallyIndex > catchIndex, "timeout cleanup must execute after provider success or failure handling");

assert.match(source, /failures\.push\(`\$\{provider\.name\}:/, "failover diagnostics must retain the provider name");
assert.match(source, /All AI providers failed: \$\{failures\.join\(["'][^"']+["']\)\}/, "terminal failure must aggregate provider diagnostics");

assert.match(providerSource, /const DEFAULT_TIMEOUT_MS = 45_000;/, "provider must retain a bounded default request timeout");
assert.match(providerSource, /const DEFAULT_MAX_REQUEST_BYTES = 1 \* 1024 \* 1024;/, "provider must retain a bounded default outbound request size");
assert.match(providerSource, /const MAX_REQUEST_BYTES = 8 \* 1024 \* 1024;/, "provider must cap configured outbound request sizes");
assert.match(providerSource, /Buffer\.byteLength\(requestBody, ["']utf8["']\) > maxRequestBytes/, "provider must enforce outbound request bytes before transport");
const requestSizeGuardIndex = providerSource.indexOf("Buffer.byteLength(requestBody");
assert.ok(requestSizeGuardIndex >= 0 && requestSizeGuardIndex < providerSource.indexOf("await assertSafeProviderDnsResolution(endpoint"), "provider must reject oversized outbound requests before DNS/network work");

assert.match(
  providerSource,
  /function resolveMaxRequestBytes\(value: number \| undefined\): number[\s\S]*?Number\.isSafeInteger\(value\)[\s\S]*?value <= 0[\s\S]*?value > MAX_REQUEST_BYTES[\s\S]*?throw new Error\(\`AI provider maxRequestBytes must be a positive safe integer/,
  "provider must fail closed for invalid or excessive outbound request size configuration",
);
assert.match(
  providerSource,
  /const requestBody = JSON\.stringify\([\s\S]*?model: this\.config\.model[\s\S]*?request\.system[\s\S]*?request\.prompt[\s\S]*?\);/,
  "provider must serialize the complete outbound model request before enforcing its byte budget",
);
assert.match(
  providerSource,
  /if \(Buffer\.byteLength\(requestBody, ["']utf8["']\) > maxRequestBytes\) \{[\s\S]*?controller\.abort\(\);[\s\S]*?throw new Error\(\`\$\{this\.name\} request exceeded size limit\`\)/,
  "oversized outbound provider requests must abort and fail before network work",
);

assert.match(providerSource, /const MAX_TIMEOUT_MS = 5 \* 60_000;/, "provider must cap configured request timeouts");
assert.match(providerSource, /Number\.isSafeInteger\(value\)[\s\S]*?value <= 0[\s\S]*?value > MAX_TIMEOUT_MS/, "provider timeout configuration must fail closed for invalid or excessive values");
assert.match(providerSource, /setTimeout\(\(\) => controller\.abort\(\), resolveTimeoutMs\(this\.config\.timeoutMs\)\)/, "provider fetch timeout must use validated configuration");
assert.match(providerSource, /if \(request\.signal\?\.aborted\)[\s\S]*?throw request\.signal\.reason \?\? new Error\("AI provider request aborted"\)/, "provider must fail before network work when its caller is already cancelled");
assert.match(providerSource, /request\.signal\?\.addEventListener\("abort", callerAbortHandler, \{ once: true \}\)/, "provider must forward caller cancellation into its internal request controller");
assert.match(providerSource, /controller\.abort\(request\.signal\?\.reason \?\? new Error\("AI provider request aborted"\)\)/, "provider must abort DNS and HTTPS work with the caller cancellation reason");
assert.match(providerSource, /request\.signal\?\.removeEventListener\("abort", callerAbortHandler\)/, "provider must clean up caller abort listeners after every outcome");
assert.match(providerSource, /assertSafeProviderDnsResolution\(endpoint, controller\.signal\)/, "provider request budget must cancel the initial DNS approval lookup");
assert.match(providerSource, /assertStableProviderDnsResolution\(endpoint, approvedAddresses, controller\.signal\)/, "provider request budget must cancel DNS rebinding revalidation");
assert.match(providerSource, /pinnedHttpsFetch\(endpoint,[\s\S]*?signal:\s*controller\.signal/, "provider request budget must cancel the pinned HTTPS transport");

// DNS rebinding defense is only useful when resolution checks complete before
// the pinned transport receives the approved address set. Keep this ordering
// covered so a future refactor cannot bypass the fail-closed guard.
const safeUrlIndex = providerSource.indexOf("assertSafeProviderUrl(");
const dnsApprovalIndex = providerSource.indexOf("await assertSafeProviderDnsResolution(endpoint");
const dnsRevalidationIndex = providerSource.indexOf("await assertStableProviderDnsResolution(endpoint, approvedAddresses");
const transportIndex = providerSource.indexOf("await pinnedHttpsFetch(endpoint");
assert.ok(safeUrlIndex >= 0, "provider must validate endpoint syntax before transport");
assert.ok(dnsApprovalIndex > safeUrlIndex, "provider must resolve and approve DNS after URL validation");
assert.ok(dnsRevalidationIndex > dnsApprovalIndex, "provider must revalidate DNS after the initial approval");
assert.ok(transportIndex > dnsRevalidationIndex, "provider must complete DNS revalidation before pinned transport hand-off");
assert.match(providerSource, /pinnedHttpsFetch\(endpoint,[\s\S]*?approvedAddresses\)/, "provider must pass only the approved DNS set to pinned transport");
assert.match(transportSource, /lookup:\s*\(_hostname, options, callback\)\s*=>/, "pinned transport must override DNS lookup at connection time");
assert.match(transportSource, /assertSafeProviderAddress\(address\)/, "pinned transport must independently reject unsafe approved addresses");
assert.match(transportSource, /url\.username \|\| url\.password \|\| url\.hash[\s\S]*?throw new Error\(["']Pinned provider transport forbids URL credentials and fragments["']\)/, "pinned transport must independently reject URL credentials and fragments before network work");
assert.match(transportSource, /servername:\s*url\.hostname/, "pinned transport must preserve TLS SNI and hostname certificate verification");
assert.match(transportSource, /rejectUnauthorized:\s*true/, "pinned transport must fail closed on untrusted provider TLS certificates");
assert.match(transportSource, /minVersion:\s*["\']TLSv1\.2["\']/, "pinned transport must reject legacy TLS versions");
assert.match(transportSource, /keepAlive:\s*false/, "pinned transport must not reuse connections across approval sets");
assert.match(transportSource, /Readable\.toWeb\(response\)/, "pinned transport must expose the live response stream without buffering it internally");
assert.doesNotMatch(transportSource, /\.finally\(\(\)\s*=>\s*agent\.destroy\(\)\)/, "pinned transport must not destroy the agent before the streamed response body reaches EOF");
assert.match(transportSource, /signal:\s*init\.signal/, "pinned transport must propagate the provider AbortSignal into the HTTPS request");
assert.match(transportSource, /const MAX_PROVIDER_RESPONSE_HEADER_BYTES = 32 \* 1024;/, "pinned transport must retain a bounded provider response header budget");
assert.match(transportSource, /const MAX_PROVIDER_REQUEST_HEADERS = 64;/, "pinned transport must retain a bounded outbound request header count");
assert.match(transportSource, /const MAX_PROVIDER_REQUEST_HEADER_BYTES = 16 \* 1024;/, "pinned transport must retain a bounded outbound request header byte budget");
assert.match(transportSource, /requestHeaderEntries\.length > MAX_PROVIDER_REQUEST_HEADERS[\s\S]*?request header count exceeds limit/, "pinned transport must reject excessive outbound request header cardinality before network work");
assert.match(transportSource, /Buffer\.byteLength\(name, ["\']utf8["\']\)[\s\S]*?Buffer\.byteLength\(value, ["\']utf8["\']\)[\s\S]*?requestHeaderBytes > MAX_PROVIDER_REQUEST_HEADER_BYTES/, "pinned transport must reject excessive outbound request header bytes before network work");
assert.match(transportSource, /maxHeaderSize:\s*MAX_PROVIDER_RESPONSE_HEADER_BYTES/, "pinned transport must enforce the provider response header budget at the Node HTTPS parser boundary");
assert.match(transportSource, /const MAX_PROVIDER_RESPONSE_HEADERS = 128;/, "pinned transport must retain a bounded provider response header count");
assert.match(transportSource, /request\.maxHeadersCount = MAX_PROVIDER_RESPONSE_HEADERS;/, "pinned transport must bound provider response header cardinality");
assert.match(transportSource, /const forbiddenResponseHeaders = new Set\(\[[\s\S]*?["']connection["'][\s\S]*?["']transfer-encoding["'][\s\S]*?["']upgrade["'][\s\S]*?\]\)/, "pinned transport must strip standard hop-by-hop response headers");
assert.match(transportSource, /response\.headers\.connection\?\.split\(["'],["']\)[\s\S]*?forbiddenResponseHeaders\.add\(name\)/, "pinned transport must strip response headers dynamically nominated by Connection");
assert.match(transportSource, /forbiddenResponseHeaders\.has\(name\.toLowerCase\(\)\)[\s\S]*?continue;/, "pinned transport must filter hop-by-hop metadata before constructing the Web Response");
assert.match(transportSource, /request\.once\(["']upgrade["'][\s\S]*?socket\.destroy\(\)[\s\S]*?reject\(new Error\(["']AI provider protocol upgrades are not supported["']\)\)/, "pinned transport must reject HTTP 101 upgrades and destroy the upgraded socket");
assert.match(transportSource, /request\.once\(["']connect["'][\s\S]*?socket\.destroy\(\)[\s\S]*?reject\(new Error\(["']AI provider CONNECT tunnels are not supported["']\)\)/, "pinned transport must reject CONNECT tunnels and destroy the detached socket");
assert.match(transportSource, /const allowedMethods = new Set\(\[["']GET["'], ["']HEAD["'], ["']POST["'], ["']PUT["'], ["']PATCH["'], ["']DELETE["'], ["']OPTIONS["']\]\)[\s\S]*?if \(!allowedMethods\.has\(method\)\)[\s\S]*?throw new Error\(`Pinned provider transport forbids HTTP method \$\{method\}`\)/, "pinned transport must allowlist supported HTTP methods and reject all others before network work");
assert.match(transportSource, /new Set\(\[["']host["'], ["']connection["'], ["']content-length["'], ["']transfer-encoding["'], ["']upgrade["'], ["']keep-alive["'], ["']proxy-authenticate["'], ["']proxy-authorization["'], ["']proxy-connection["'], ["']te["'], ["']trailer["']\]\)[\s\S]*?forbiddenRequestHeaders\.has\(name\.toLowerCase\(\)\)[\s\S]*?throw new Error\(`Pinned provider transport forbids caller-controlled HTTP header \$\{name\}`\)/, "pinned transport must reject caller-controlled routing and message-framing headers before network work");
assert.match(transportSource, /if \(status < 200 \|\| status > 599\) \{[\s\S]*?response\.destroy\(\);[\s\S]*?reject\(new Error\(`AI provider returned invalid HTTP status \$\{status\}`\)\);[\s\S]*?return;/, "pinned transport must fail closed on invalid upstream HTTP status codes");
assert.match(transportSource, /if\s*\(!mayHaveBody\)\s*response\.resume\(\)/, "bodyless responses must be drained so pinned sockets cannot remain hung until timeout");
assert.doesNotMatch(transportSource, /statusText:\s*response\.statusMessage/, "pinned transport must not forward untrusted upstream reason phrases into Fetch Response construction");
assert.doesNotMatch(transportSource, /response\.headers\.location|statusCode\s*>?=\s*300[\s\S]*?httpsRequest/, "pinned transport must not implement automatic redirect following");
assert.match(providerUrlPolicySource, /const PROVIDER_DNS_TIMEOUT_MS = 5_000;/, "provider DNS resolution must have a short bounded timeout");
assert.match(providerUrlPolicySource, /const MAX_PROVIDER_DNS_ADDRESSES = 32;/, "provider DNS resolution must retain a bounded address count");
assert.match(providerUrlPolicySource, /addresses\.length > MAX_PROVIDER_DNS_ADDRESSES[\s\S]*?resolved to too many addresses/, "provider DNS resolution must reject excessive address cardinality before canonicalization");
assert.match(providerUrlPolicySource, /Promise\.race\(\[[\s\S]*?lookup\(host, \{ all: true, verbatim: true \}\)[\s\S]*?PROVIDER_DNS_TIMEOUT_MS[\s\S]*?\]\)/, "provider DNS lookup must race against the bounded timeout");
assert.match(providerUrlPolicySource, /finally\s*\{[\s\S]*?clearTimeout\(timeout\)/, "provider DNS timeout timer must be cleared after resolution settles");
assert.match(providerUrlPolicySource, /lookupWithTimeout\(host: string, signal\?: AbortSignal\)/, "provider DNS lookup must accept cancellation from the request budget");
assert.match(providerUrlPolicySource, /signal\.addEventListener\("abort", abortHandler, \{ once: true \}\)/, "provider DNS lookup must stop waiting when the request is aborted");
assert.match(providerUrlPolicySource, /signal\.removeEventListener\("abort", abortHandler\)/, "provider DNS lookup must clean up abort listeners after settlement");

assert.match(telemetrySource, /const TELEMETRY_QUERY_TIMEOUT_MS = 2_000;/, "telemetry persistence must have a short bounded query timeout");
assert.match(telemetrySource, /async function recordTelemetry[\s\S]*?try\s*\{[\s\S]*?await db\.query\(\{[\s\S]*?query_timeout: TELEMETRY_QUERY_TIMEOUT_MS,[\s\S]*?\}\);[\s\S]*?\}\s*catch\s*\{/, "telemetry writes must be isolated behind a bounded best-effort boundary");
assert.doesNotMatch(telemetrySource, /catch\s*\(error\)\s*\{[\s\S]*?await db\.query\(/, "provider failures must not be masked by a direct telemetry database write");
assert.match(telemetrySource, /catch\s*\(error\)\s*\{[\s\S]*?void recordTelemetry\([\s\S]*?throw error;/, "provider failures must preserve the original error without waiting for best-effort telemetry");
assert.match(telemetrySource, /void recordTelemetry\([\s\S]*?return response;/, "successful provider responses must not wait for telemetry persistence");
assert.doesNotMatch(telemetrySource, /catch\s*\(error\)\s*\{[\s\S]*?await recordTelemetry\(/, "provider failure telemetry must remain off the critical path");

assert.doesNotThrow(() => assertSafeProviderUrl("https://api.example.com/v1"));
assert.doesNotThrow(() => assertSafeProviderAddress("203.0.114.10"));
for (const unsafeAddress of ["127.0.0.1", "10.0.0.1", "::1", "64:ff9b::7f00:1", "not-an-ip"]) {
  assert.throws(() => assertSafeProviderAddress(unsafeAddress), undefined, `provider address must reject ${unsafeAddress}`);
}
for (const unsafeUrl of [
  "https://user:secret@api.example.com/v1",
  "https://api.example.com/v1#internal",
  "https://localhost/v1",
  "https://service.localhost/v1",
  "https://127.0.0.1/v1",
  "https://10.0.0.1/v1",
  "https://169.254.169.254/latest/meta-data",
  "https://[::1]/v1",
  "https://[::]/v1",
  "https://[fc00::1]/v1",
  "https://[fd12:3456::1]/v1",
  "https://[fe80::1]/v1",
  "https://[100::1]/v1",
  "https://[2001:2::1]/v1",
  "https://[2001:db8::1]/v1",
  "https://[3fff::1]/v1",
  "https://[64:ff9b::7f00:1]/v1",
  "https://[64:ff9b:0:0:0:0:7f00:1]/v1",
  "https://[64:ff9b:1::7f00:1]/v1",
  "https://[ff02::1]/v1",
  "https://[::ffff:127.0.0.1]/v1",
]) {
  assert.throws(() => assertSafeProviderUrl(unsafeUrl), undefined, `provider URL must reject ${unsafeUrl}`);
}

assert.ok(
  transportSource.includes("const validHeaderName =") &&
    transportSource.includes("!validHeaderName.test(name)") &&
    transportSource.includes("/[\\r\\n\\0]/.test(value)"),
  "pinned transport must reject malformed outbound header names and control characters before network work",
);

assert.ok(
  transportSource.includes('const allowedMethods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])') &&
    transportSource.includes("!allowedMethods.has(method)"),
  "pinned transport must allowlist outbound HTTP methods before network work",
);

console.log("AI failover, telemetry resilience, and provider URL regression checks passed");