import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/ai/failover-provider.ts", import.meta.url), "utf8");

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
assert.match(source, /failures\.join\("; "\)/, "terminal failure must aggregate provider diagnostics");

console.log("AI failover regression checks passed");
