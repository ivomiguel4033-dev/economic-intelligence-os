# Railway first-production-deploy gate

This runbook is a manual release gate. A green GitHub CI run does **not** prove that the Railway environment is ready.

## 1. Confirm the exact release candidate

- Record the commit SHA on `feature/production-readiness-v1.1` and the passing CI run for that SHA.
- Confirm PR #11 has no unresolved review or branch-protection requirements.
- Inspect the Railway staged diff before applying any changes. Do not blindly apply legacy worker or configuration changes.

## 2. Configure the web service

Provide the following values using Railway's secret-variable controls; never commit real values:

- `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL`
- `AI_PRIMARY_BASE_URL`, `AI_PRIMARY_API_KEY`, `AI_PRIMARY_MODEL`

Also confirm `NODE_ENV=production`, `DATABASE_URL`, `SECURITY_EVENT_HASH_PEPPER`, and `METRICS_TOKEN`. OIDC and AI endpoints must pass `node scripts/production-preflight.mjs`. Do not use placeholder credentials or example endpoints for deployment.

## 3. Reconcile the Railway architecture

- Connect the web service to the intended GitHub repository, branch and Dockerfile.
- Confirm the PostgreSQL service is deployed and reachable before migrations.
- Leave the legacy worker disabled until its entrypoint and responsibilities match the current code.
- Verify `railway.json` applies the pre-deploy preflight and migrations, `/api/ready` health check and graceful drain configuration.

## 4. Deploy with a rollback plan

- Identify a known-good deployment and a tested way to restore it **before** initiating a production change. If no known-good deployment exists, treat this as an initial launch, not a rollback-capable upgrade.
- Preserve database backups and verify recovery procedures before the first migration. Schema migrations may not be reversible by simply reverting application code.
- Deploy only after the real environment passes preflight and all relevant CI checks pass.
- Run `node scripts/production-smoke.mjs https://<actual-public-service-origin>` after deployment. It requires JSON liveness and database readiness responses with no-store caching.
- On a failed smoke check, stop traffic or roll back the application to the recorded known-good deployment as appropriate; evaluate database schema compatibility separately. Do not claim success based only on a running container.

## 5. Release evidence

Record the release SHA, CI run URL, Railway deployment ID, preflight result, smoke-test result, database backup/recovery reference and rollback target. Keep secrets out of the record.
