# Production first-deployment checklist (Railway)

This is an operator checklist, **not** an automated production approval. Do not deploy from a green CI result alone. Record real evidence; never set gate flags to true merely to satisfy the validator.

## Before touching the production environment

1. Confirm PR #11's exact commit SHA and successful CI run for that SHA, including the Docker image and in-container preflight smoke test. Record the run URL.
2. Inspect Railway's **14 legacy staged changes** against the intended service configuration. Do not apply the staged patch wholesale. Keep the legacy worker inactive until a supported worker entrypoint is explicitly defined.
3. Configure the web service's production `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL`, `AI_PRIMARY_BASE_URL`, `AI_PRIMARY_API_KEY` and `AI_PRIMARY_MODEL` through Railway's secret/configuration controls. Never commit credentials or paste secret values into release evidence.
4. Verify the PostgreSQL connection, migration permissions and a recent restorable backup. Identify the person responsible for rollback and confirm their access to Railway and the database.
5. Review the repository's `railway.json`: Dockerfile build, `node scripts/production-preflight.mjs && npm run migrate` pre-deploy command, `/api/ready` health check, 120-second health-check timeout and 30-second draining period. Confirm these settings match the *actual* Railway web service before deployment.

## Controlled launch

1. Run the production preflight in the intended runtime environment; a local or CI-only preflight does not prove Railway secrets are correct.
2. Deploy the verified commit to the **web** service only. Confirm migrations finish successfully and the new deployment reaches healthy status.
3. Run authenticated OIDC login/tenant-isolation checks and a small, cost-bounded AI provider request. Check `/api/ready`, the protected metrics endpoint and application logs for errors, secret leakage or unexpected retries.
4. Observe readiness and errors during a defined monitoring window. If a gate fails, stop the rollout and investigate before approving the release.
5. Generate a draft using `node scripts/production-release-evidence-draft.mjs <path>`; fill it with independently verified facts and validate using `node scripts/check-production-release-evidence.mjs <path>`. Do not commit the evidence if it contains sensitive operational details.

## Rollback and recovery

- **First deployment:** there is no verified previous production deployment. Set `firstLaunch=true`, leave `rollbackDeploymentId` empty and set `rollbackVerified=false`. Prepare a recovery plan from the backup and deployment configuration; do not claim a verified rollback target.
- **Subsequent deployment:** before releasing, identify and verify a *distinct*, recoverable previous deployment and record its ID. Confirm database compatibility: reverting application code does **not** undo a destructive schema migration.
- On failed health checks, authentication, AI smoke tests or material error-rate regression, stop traffic to the failing version and follow the approved Railway recovery procedure. Re-check readiness, login, tenant isolation and data integrity after recovery.

## Stop/go decision and incident evidence

Before deployment, assign an operator and a separate reviewer. Record a UTC timestamp, exact Git SHA and CI run URL, the intended Railway service/environment, and the go/no-go decision. A successful CI run is necessary but never sufficient for **GO**.

| Observation | Decision | Immediate action |
| --- | --- | --- |
| CI is pending, failed, cancelled or belongs to a different SHA | NO-GO | Wait or fix CI; do not deploy an unverified commit. |
| OIDC or AI production configuration is absent, preflight fails, or Railway staging is unresolved | NO-GO | Reconcile configuration without exposing secrets; rerun preflight. |
| Backup restore has not been verified or migrations are not reviewed for backward compatibility | NO-GO | Verify recovery and migration safety before any production change. |
| Post-deploy readiness, authenticated tenant isolation or bounded AI smoke test fails | STOP / RECOVER | Preserve logs and deployment ID, halt rollout, execute the approved recovery plan and retest. |
| All independent gates pass and the monitoring window is clean | GO candidate | Obtain operator/reviewer sign-off and retain evidence. |

For any STOP / RECOVER event, record detection time, affected deployment ID, symptoms, the recovery decision, responsible operator, recovery completion time and results of post-recovery readiness, authentication, tenant isolation and data-integrity checks. Never put API keys, bearer tokens or raw personal data into incident evidence. If this is the first deployment, do **not** claim that a previous Railway deployment can be rolled back to; document backup-based recovery and its limitations instead.

## Release sign-off

Retain the exact commit, CI run, Railway deployment ID, backup verification, migration review, OIDC and AI smoke-test results, observation outcome and the responsible operator. The evidence validator checks record structure and required assertions; it **cannot** independently verify Railway, OIDC, backups or AI provider health.
