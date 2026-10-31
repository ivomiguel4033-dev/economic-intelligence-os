# Production release gate (PR #11)

This runbook is a manual release checklist, not permission to deploy. Keep the legacy Railway worker inactive until its current entrypoint is reviewed.

## 1. Source and CI gate

1. Verify that PR #11 targets the intended base and its head matches the commit being released.
2. Require successful CI for that exact head, including production Docker build, in-container preflight, regression tests and smoke-test coverage. A green run for an older SHA is insufficient.
3. Do not bypass branch protection or force-push. Do not merge while checks are queued, running or failing.

## 2. Railway environment gate

1. Review the **14 legacy staged changes** in the existing Railway environment individually. Do not apply the staged patch blindly.
2. Configure production OIDC values `OIDC_ISSUER`, `OIDC_AUDIENCE` and `OIDC_JWKS_URL` as Railway runtime configuration; verify the issuer, audience and JWKS endpoint belong to the intended identity provider.
3. Configure `AI_PRIMARY_BASE_URL`, `AI_PRIMARY_API_KEY` and `AI_PRIMARY_MODEL` at runtime. Keep secrets out of commits, logs and Docker build arguments.
4. Verify the web service uses the current Docker image, pre-deploy migration command, readiness health check and bounded graceful drain. Keep the old worker service inactive.
5. Execute the repository production preflight against the actual target environment. Stop if it fails; do not substitute placeholder credentials.

## 3. Controlled deployment and smoke gate

1. Record the previous known-good Railway deployment identifier, its image digest and the current database migration version before promotion.
2. Deploy only the web service after the gates above pass. Record the new deployment identifier and image digest.
3. Run `node scripts/production-smoke.mjs https://<actual-web-origin>` from a trusted runner. The origin must be the real HTTPS web-service origin, without a path, query, fragment or credentials.
4. Require both `/api/health` and `/api/ready` to pass. Check logs and metrics for authentication, database, provider and startup errors before accepting traffic.
5. If any gate fails, stop promotion and preserve deployment logs, CI run URL and failing response metadata without copying secrets.

## 4. Rollback gate

1. Revert the web service to the recorded known-good image/deployment using Railway's supported deployment controls; do not rewrite Git history.
2. Re-run the same production smoke command and inspect logs and metrics.
3. **Database caution:** never assume application rollback reverses migrations. Verify schema compatibility before rollback; use a separately reviewed recovery plan for non-backward-compatible migrations.
4. Record the incident, failed deployment ID, restored deployment ID, smoke outcome and follow-up action in PR #11 or the incident tracker.

**Release remains blocked** until the real OIDC/AI values, Railway staged-change reconciliation, and successful target-environment preflight are verified. This document does not certify that any of those steps have occurred.
