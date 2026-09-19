import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const sourcePath = new URL("../src/billing/webhook-signature.ts", import.meta.url);
const source = await readFile(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const { verifyStripeSignature } = await import(moduleUrl);

const payload = JSON.stringify({ id: "evt_rotation", type: "customer.subscription.updated" });
const secret = "whsec_current";
const timestamp = Math.floor(Date.now() / 1000);
const sign = (value = payload, key = secret, at = timestamp) =>
  createHmac("sha256", key).update(`${at}.${value}`).digest("hex");

assert.equal(verifyStripeSignature(payload, `t=${timestamp},v1=${sign()}`, secret), true);
assert.equal(
  verifyStripeSignature(payload, `t=${timestamp},v1=${sign(payload, "whsec_previous")},v1=${sign()}`, secret),
  true,
  "secret rotation must accept the matching v1 among multiple signatures",
);
assert.equal(
  verifyStripeSignature(payload, `t=${timestamp},v1=${sign(payload, "whsec_previous")},v1=${sign(payload, "whsec_other")}`, secret),
  false,
);
assert.equal(verifyStripeSignature(`${payload} `, `t=${timestamp},v1=${sign()}`, secret), false, "payload tampering must fail");
assert.equal(verifyStripeSignature(payload, `t=${timestamp - 301},v1=${sign(payload, secret, timestamp - 301)}`, secret), false);
assert.equal(verifyStripeSignature(payload, `t=${timestamp},t=${timestamp - 1},v1=${sign()}`, secret), false);
assert.equal(verifyStripeSignature(payload, `t=not-a-number,v1=${sign()}`, secret), false);
assert.equal(verifyStripeSignature(payload, `t=${timestamp},v1=zz${"0".repeat(62)}`, secret), false);
assert.equal(verifyStripeSignature(payload, `t=${timestamp},v1=${sign()},${"x=1,".repeat(32)}x=1`, secret), false);
assert.equal(verifyStripeSignature(payload, `t=${timestamp},v1=${sign()}${" ".repeat(4096)}`, secret), false);

console.log("Stripe signature regression checks passed: rotation, freshness, tamper resistance and parser limits.");
