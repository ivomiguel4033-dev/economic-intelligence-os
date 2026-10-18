# Production readiness release gate (PR #11)

This runbook describes an operator-controlled release. A green GitHub CI run is necessary but **not** sufficient for production approval. Never commit credentials or a completed evidence record containing secrets.

## Before a Railway deployment

1. Confirm the release commit SHA, PR #11 review state, and successful CI for that exact commit. Run `node scripts/production-release-evidence-check-suite.mjs` locally to validate the evidence tooling.
2. Inspect Railway's existing staged changes individually. The PR identifies 14 legacy staged changes; do **not** apply them as a batch. Keep the legacy worker inactive until its entrypoint is intentionally migrated.
3. Configure production `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL` and verify the identity issuer and JWKS from the deployed environment. Do not use example endpoints.
4. Configure `AI_PRIMARY_BASE_URL`, `AI_PRIMARY_API_KEY`, and `AI_PRIMARY_MODEL`; verify provider connectivity and failure behavior without logging credentials.
5. Confirm database reachability, a recent restorable backup, reviewed migrations, and the expected production security baseline. Run `node scripts/production-preflight.mjs` with the actual target environment before promoting a deployment.

## Deploy and verify

1. Record the current healthy Railway deployment ID as the rollback target **before** an upgrade. For the first launch, explicitly record `firstLaunch: true` and do not invent a rollback deployment ID.
2. Deploy the reviewed commit to the intended web service only. Record the resulting Railway deployment ID.
3. Run `node scripts/production-smoke.mjs https://<production-host>`. This checks both `/api/health` and database-aware `/api/ready`; HTTP 200 alone is not a pass.
4. Observe application errors, readiness, and service metrics after promotion. A failed smoke check or degraded observation is a **NO-GO**: stop promotion and use the previously recorded healthy deployment for rollback when one exists. For a first launch, disable exposure and investigate instead of claiming a rollback target.
5. Generate a fail-closed draft with `node scripts/production-release-evidence-draft.mjs <new-evidence.json>`. Fill fields only from verified evidence and validate using `node scripts/check-production-release-evidence.mjs <new-evidence.json>`.

## Release decision

The evidence validator requires a 40-character commit SHA, a CI run URL for this repository, the Railway deployment ID, an explicit first-launch flag, and affirmative checks for CI, staged changes, preflight, OIDC, AI, PostgreSQL, backup, migration, smoke, and post-release observation. For upgrades, the rollback deployment ID must be present and distinct from the new deployment.

**Fail closed:** missing configuration, incomplete evidence, unhealthy readiness, or uncertain rollback capability means **NO-GO**. A syntactically valid evidence file is not independent proof that the external production environment is healthy.
