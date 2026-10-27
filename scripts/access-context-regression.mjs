import assert from "node:assert/strict";
import { assuranceFromClaims, normalizeVerifiedIdentity, parseOidcJwksUrl } from "../src/security/oidc.ts";

// The runtime JWKS client must reject ambiguous or credential-bearing endpoints
// even when it is instantiated outside the production preflight.
for (const invalidJwksUrl of [
  "http://idp.example/keys",
  "https://user:secret@idp.example/keys",
  "https://idp.example/keys#",
  "https://idp.example/keys#fragment",
  "https://idp.example\\@evil.test/keys",
  " https://idp.example/keys",
  "https://idp.example/keys ",
  "https://idp.example/keys\n",
  // WHATWG URL accepts slashless HTTPS and strips empty userinfo.
  "https:idp.example/keys",
  "https:/idp.example/keys",
  "https:///idp.example/keys",
  "https://@idp.example/keys",
  // Encoded authority bytes and bind-only port zero must never reach JWKS fetch.
  "https://%69dp.example/keys",
  "https://idp.example:0/keys",
  "not-a-url",
]) {
  assert.throws(() => parseOidcJwksUrl(invalidJwksUrl), /OIDC JWKS URL/, invalidJwksUrl);
}
assert.equal(parseOidcJwksUrl("https://idp.example/keys?tenant=abc").search, "?tenant=abc");
assert.equal(parseOidcJwksUrl("https://idp.example/.well-known/jwks.json").hostname, "idp.example");
assert.equal(parseOidcJwksUrl("https://idp.example:8443/keys").port, "8443");
assert.equal(parseOidcJwksUrl("https://idp.example/%6beys").pathname, "/%6beys");

// ACR names are opaque identifiers. Partial text must not elevate assurance.
for (const acr of ["no-mfa", "non-phishing-resistant", "untrusted-phr", "no-aal3",
  "urn:example:acr:disabled-mfa", "urn:example:acr:aal2-low", "https://idp.example/acr/not-phr"]) {
  assert.equal(assuranceFromClaims([], acr), "password", `ACR must not elevate assurance: ${acr}`);
}
for (const [amr, acr, expected] of [
  [["webauthn"], "mfa", "phishing-resistant"],
  [["FIDO2"], undefined, "phishing-resistant"],
  [["hwk"], undefined, "phishing-resistant"],
  [["OTP"], undefined, "mfa"],
  [["sms"], undefined, "mfa"],
  [[], "urn:example:acr:aal3", "phishing-resistant"],
  [[], "urn:example:acr:phr", "phishing-resistant"],
  [[], "urn:example:acr:aal2", "mfa"],
  [[], "urn:example:acr:mfa", "mfa"],
  [[42, null], "unknown", "password"],
]) {
  assert.equal(assuranceFromClaims(amr, acr), expected);
}
assert.equal(normalizeVerifiedIdentity({
  iss: "https://identity.example", sub: "actor-a", aud: "api",
  exp: Math.floor(Date.now() / 1000) + 120, acr: "not-mfa",
}).assurance, "password");

import { db } from "../src/infrastructure/database/postgres.ts";
import { resolveAccessContext } from "../src/security/access-context.ts";
import { resolveOrganizationForActor } from "../src/security/organization-selection.ts";
import { bearerToken } from "../src/security/request-auth.ts";

assert.equal(bearerToken("Bearer eyJhbGciOiJSUzI1NiJ9.payload.signature"), "eyJhbGciOiJSUzI1NiJ9.payload.signature");
for (const value of ["Bearer token ", "Bearer to ken", "Bearer token\\nextra", "Bearer token,other", "Bearer " + "a".repeat(8_193)]) {
  assert.throws(() => bearerToken(value), /Invalid bearer token/);
}


const originalQuery = db.query;

async function withRows(rows, assertion) {
  db.query = async () => ({ rowCount: rows.length, rows });
  try {
    await assertion();
  } finally {
    db.query = originalQuery;
  }
}

for (const [actorId, organizationId] of [
  ["", "org-a"],
  [" actor-a", "org-a"],
  ["actor-a", "org-a "],
  ["actor\na", "org-a"],
  ["actor-a", "org\ta"],
  [null, "org-a"],
  [42, "org-a"],
  ["actor-a", null],
  ["actor-a", 42],
]) {
  await assert.rejects(() => resolveAccessContext(actorId, organizationId), /Invalid access context identity/);
}

await withRows([], async () => {
  await assert.rejects(() => resolveAccessContext("actor-a", "org-a"), /Organization membership required/);
});

for (const role of [null, 42, "", " ", " admin", "admin ", "ad\nmin"]) {
  await withRows([{ role, permissions: ["decision:read"] }], async () => {
    await assert.rejects(() => resolveAccessContext("actor-a", "org-a"), /Invalid organization role configuration/);
  });
}

for (const permissions of ["decision:read", [null], [42], [""], [" decision:read"], ["decision:read "], ["decision:\nread"]]) {
  await withRows([{ role: "admin", permissions }], async () => {
    await assert.rejects(() => resolveAccessContext("actor-a", "org-a"), /Invalid organization permission configuration/);
  });
}

await withRows([
  { role: "admin", permissions: ["decision:read", "decision:execute"] },
  { role: "admin", permissions: ["decision:read"] },
], async () => {
  const context = await resolveAccessContext("actor-a", "org-a");
  assert.deepEqual(context, {
    actorId: "actor-a",
    organizationId: "org-a",
    roles: ["admin"],
    permissions: ["decision:read", "decision:execute"],
  });
});

await assert.rejects(() => resolveOrganizationForActor(""), /Invalid actor identity/);
await assert.rejects(() => resolveOrganizationForActor(" actor-a"), /Invalid actor identity/);
await assert.rejects(() => resolveOrganizationForActor("actor-a", ""), /Invalid organization selection/);
await assert.rejects(() => resolveOrganizationForActor("actor-a", "org-a "), /Invalid organization selection/);

await withRows([], async () => {
  await assert.rejects(() => resolveOrganizationForActor("actor-a", "org-b"), /Organization access denied/);
});

await withRows([{ allowed: 1 }], async () => {
  assert.equal(await resolveOrganizationForActor("actor-a", "org-a"), "org-a");
});

await withRows([], async () => {
  await assert.rejects(() => resolveOrganizationForActor("actor-a"), /No organization membership found/);
});

await withRows([{ organization_id: "org-a" }, { organization_id: "org-b" }], async () => {
  await assert.rejects(() => resolveOrganizationForActor("actor-a"), /Organization selection required/);
});

for (const organization_id of [null, 42, "", " org-a", "org-a "]) {
  await withRows([{ organization_id }], async () => {
    await assert.rejects(() => resolveOrganizationForActor("actor-a"), /Invalid organization membership/);
  });
}

await withRows([{ organization_id: "org-a" }], async () => {
  assert.equal(await resolveOrganizationForActor("actor-a"), "org-a");
});

console.log("Access-context and organization-selection security regression checks passed.");
