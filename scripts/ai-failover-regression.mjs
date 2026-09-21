import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertSafeProviderUrl } from "../src/security/provider-url-policy.ts";

const source = await readFile(new URL("../src/ai/failover-provider.ts", import.meta.url), "utf8");
const providerSource = await readFile(new URL("../src/ai/providers/openai-compatible-provider.ts", import.meta.url), "utf8");
const transportSource = await readFile(new URL("../src/http/pinned-https-transport.ts", import.meta.url), "utf8");
const providerUrlPolicySource = await readFile(new URL("../src/security/provider-url-policy.ts", import.meta.url), "utf8");
const telemetrySource = await readFile(new URL("../src/ai/providers/telemetry-provider.ts", import.meta.url), "utf8");

assert.match(source, /const DEFAULT_TIMEOUT_MS = 30_000;/, "failover must retain a bounded default timeout");
assert.match(source, /Number\.isSafeInteger\(timeoutMs\)/, "timeout must reject non-safe integers");
assert.match(source, /timeoutMs <= 0/, "timeout must reject zero and negative values");
assert.match(source, /At least one AI provider is required/, "failover must reject an empty provider chain");
assert.match(source, /Promise\.race\(\[provider\.generate\(request\), timeoutPromise\]\)/, "each provider attempt must race against its timeout");
assert.match(source, /finally\s*\{[\s\S]*?clearTimeout\(timeout\);[\s\S]*?\}/, "provider timers must be cleared on every settled attempt");

const catchIndex = source.indexOf("} catch (error) {");
const finallyIndex = source.indexOf("} finally {");
const loopIndex = source.indexOf("for (const provider of this.providers)");
assert.ok(loopIndex >= 0 && catchIndex > loopIndex, "provider failures must be handled inside the failover loop");
assert.ok(finallyIndex > catchIndex, "timeout cleanup must execute after provider success or failure handling");

assert.match(source, /failures\.push\(`\$\{provider\.name\}:/, "failover diagnostics must retain the provider name");
assert.match(source, /All AI providers failed: \$\{failures\.join\(["'][^"']+["']\)\}/, "terminal failure must aggregate provider diagnostics");

assert.match(providerSource, /const DEFAULT_TIMEOUT_MS = 45_000;/, "provider must retain a bounded default request timeout");
assert.match(providerSource, /const MAX_TIMEOUT_MS = 5 \* 60_000;/, "provider must cap configured request timeouts");
assert.match(providerSource, /Number\.isSafeInteger\(value\)[\s\S]*?value <= 0[\s\S]*?value > MAX_TIMEOUT_MS/, "provider timeout configuration must fail closed for invalid or excessive values");
assert.match(providerSource, /setTimeout\(\(\) => controller\.abort\(\), resolveTimeoutMs\(this\.config\.timeoutMs\)\)/, "provider fetch timeout must use validated configuration");
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
assert.match(transportSource, /servername:\s*url\.hostname/, "pinned transport must preserve TLS SNI and hostname certificate verification");
assert.match(transportSource, /keepAlive:\s*false/, "pinned transport must not reuse connections across approval sets");
assert.match(transportSource, /Readable\.toWeb\(response\)/, "pinned transport must expose the live response stream without buffering it internally");
assert.doesNotMatch(transportSource, /\.finally\(\(\)\s*=>\s*agent\.destroy\(\)\)/, "pinned transport must not destroy the agent before the streamed response body reaches EOF");
assert.match(transportSource, /signal:\s*init\.signal/, "pinned transport must propagate the provider AbortSignal into the HTTPS request");
assert.match(transportSource, /if\s*\(!mayHaveBody\)\s*response\.resume\(\)/, "bodyless responses must be drained so pinned sockets cannot remain hung until timeout");
assert.doesNotMatch(transportSource, /response\.headers\.location|statusCode\s*>?=\s*300[\s\S]*?httpsRequest/, "pinned transport must not implement automatic redirect following");
assert.match(providerUrlPolicySource, /const PROVIDER_DNS_TIMEOUT_MS = 5_000;/, "provider DNS resolution must have a short bounded timeout");
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
  "https://[ff02::1]/v1",
  "https://[::ffff:127.0.0.1]/v1",
]) {
  assert.throws(() => assertSafeProviderUrl(unsafeUrl), undefined, `provider URL must reject ${unsafeUrl}`);
}

console.log("AI failover, telemetry resilience, and provider URL regression checks passed");