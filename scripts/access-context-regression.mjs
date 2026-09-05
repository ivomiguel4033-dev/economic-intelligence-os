import assert from "node:assert/strict";
import { db } from "../src/infrastructure/database/postgres.ts";
import { resolveAccessContext } from "../src/security/access-context.ts";
import { resolveOrganizationForActor } from "../src/security/organization-selection.ts";

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

for (const role of [null, 42, "", " ", " admin", "admin "]) {
  await withRows([{ role, permissions: ["decision:read"] }], async () => {
    await assert.rejects(() => resolveAccessContext("actor-a", "org-a"), /Invalid organization role configuration/);
  });
}

for (const permissions of ["decision:read", [null], [42], [""], [" decision:read"], ["decision:read "]]) {
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
