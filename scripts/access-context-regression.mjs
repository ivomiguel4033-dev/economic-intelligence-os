import assert from "node:assert/strict";
import { db } from "../src/infrastructure/database/postgres.ts";
import { resolveAccessContext } from "../src/security/access-context.ts";

const originalQuery = db.query;

async function withRows(rows, assertion) {
  db.query = async () => ({ rowCount: rows.length, rows });
  try {
    await assertion();
  } finally {
    db.query = originalQuery;
  }
}

await assert.rejects(() => resolveAccessContext("", "org-a"), /Invalid access context identity/);
await assert.rejects(() => resolveAccessContext(" actor-a", "org-a"), /Invalid access context identity/);
await assert.rejects(() => resolveAccessContext("actor-a", "org-a "), /Invalid access context identity/);

await withRows([], async () => {
  await assert.rejects(() => resolveAccessContext("actor-a", "org-a"), /Organization membership required/);
});

for (const role of ["", " ", " admin", "admin "]) {
  await withRows([{ role, permissions: ["decision:read"] }], async () => {
    await assert.rejects(() => resolveAccessContext("actor-a", "org-a"), /Invalid organization role configuration/);
  });
}

for (const permissions of ["decision:read", [""], [" decision:read"], ["decision:read "]]) {
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

console.log("Access-context membership and role configuration regression checks passed.");
