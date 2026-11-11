# Railway legacy staging reconciliation (production)

This is an **operator-controlled, no-deploy** procedure for reconciling the legacy Railway environment with the current application. Do not accept the entire pending patch as a shortcut. A green CI run does not establish that Railway is configured.

## Observed inventory (2026-10-14; re-check before acting)

- Project: `Economic Intelligence OS`; environment: `production`.
- Pending environment patch: **12 staged changes** (two service configuration updates and ten variable changes). The detailed pending-work inventory can display 14 resource/variable operations; use the environment patch's change count as the canonical count, not a manually counted UI list.
- `web`: no GitHub source connected, no active deployment; eight staged changes.
- `worker`: no GitHub source connected, no active deployment; four staged changes. Its legacy entrypoint is **not** an approved production worker for this branch.
- `Postgres`: no active deployment; persistent volume is present. A volume is not proof of a healthy database or recoverable backup.
- The service states were all offline at inspection time. No changes were applied.

## Reconcile the staged diff without deploying

1. Record the patch ID, timestamp, affected services, and the exact proposed before/after values **privately**. Do not copy secrets into issues, logs or release evidence.
2. For `web`, examine the staged service configuration update and the proposed changes to `PORT`, `APP_URL`, `NODE_ENV`, `DB_DRIVER`, `JWT_SECRET`, `DATABASE_URL`, `FILE_ENCRYPTION_KEY` and `CONNECTOR_ENCRYPTION_KEY`. Check each against the **current** application's requirements; do not assume older variables are still consumed.
3. For `worker`, examine its staged service configuration update and `NODE_ENV`, `DB_DRIVER`, `FILE_ENCRYPTION_KEY`, `CONNECTOR_ENCRYPTION_KEY`. Keep this service inactive until a current entrypoint and workload ownership are documented and tested.
4. For every proposed change, classify it as **retain**, **replace with a reviewed value**, or **discard**. Obtain an explicit release decision before applying anything. If Railway cannot safely separate legacy changes, stop and prepare a clean, reviewed environment rather than accepting the patch wholesale.
5. Check the **actual deployed** configuration separately from staged configuration. Re-inspect the pending patch immediately before any approval; it may have changed since this document was written.

## Required production values (verify presence, not secret contents)

The `web` service was missing these six names at inspection time:

- OIDC: `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL`.
- AI: `AI_PRIMARY_BASE_URL`, `AI_PRIMARY_API_KEY`, `AI_PRIMARY_MODEL`.

Also verify `NODE_ENV=production`, a working `DATABASE_URL`, `SECURITY_EVENT_HASH_PEPPER` and `METRICS_TOKEN`. The Railway connector may redact values; the presence of a variable name does **not** prove its value is valid. Never replace a sealed variable merely because its value cannot be read back.

## Release sequencing and stop conditions

1. Resolve the staged diff and review the web service's GitHub source, target branch and Docker build configuration. **Do not connect a source that automatically deploys** until release prerequisites are satisfied.
2. Establish PostgreSQL health, migration compatibility, a verified backup and a recovery procedure. Confirm that the intended database connection resolves inside Railway.
3. Configure genuine OIDC and primary AI provider credentials using Railway secrets. Execute `node scripts/production-preflight.mjs` in the intended runtime environment; placeholders are not sufficient.
4. Record the exact commit SHA and successful CI run. For an upgrade, identify a known-good deployment and verify the rollback method; for the first launch, explicitly record **no rollback target**.
5. Only then authorize a controlled deployment. Run `node scripts/production-smoke.mjs https://<actual-public-service-origin>` and capture the result without credentials or customer data.

**NO-GO:** any missing OIDC/AI value, offline PostgreSQL, unreviewed staged changes, failed preflight, missing backup/recovery evidence, or missing compatible rollback plan for an upgrade. Application rollback does not undo database migrations.
