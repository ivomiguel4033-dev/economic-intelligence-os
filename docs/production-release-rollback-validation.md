# Production release and rollback verification

This checklist supplements the automated production preflight and smoke tests. A passing CI run alone does not authorize a Railway production deployment.

## Before any production release

- Confirm the intended full 40-character commit SHA matches the green CI run and the release candidate.
- Review Railway staged changes individually. The 14 legacy staged changes must not be applied blindly.
- Keep the legacy worker inactive until its entrypoint and deployment contract are intentionally updated.
- Confirm production OIDC_ISSUER, OIDC_AUDIENCE, OIDC_JWKS_URL and AI_PRIMARY_BASE_URL, AI_PRIMARY_API_KEY, AI_PRIMARY_MODEL are configured securely in Railway. Never paste their secret values into release evidence or CI logs.
- Confirm PostgreSQL connectivity, backup and recovery procedure, migration review, and production preflight.
- Before an upgrade, identify and record the last known-good Railway deployment ID. For the first launch, record firstLaunch=true and leave rollbackDeploymentId empty.

## Controlled deployment

1. Deploy only the reviewed web-service configuration and exact commit SHA.
2. Capture the Railway deployment ID and the matching CI run URL.
3. Run the production smoke checks against the deployed service; verify live readiness and liveness, not a cached response.
4. Observe service health, error rates, database connectivity, and AI-provider failures before declaring success.
5. Store a release evidence JSON record and run `node scripts/check-production-release-evidence.mjs <path-to-evidence.json>`. The validator checks required fields, not the truth of external observations.

## Rollback decision

- If readiness, smoke checks, or post-release observation fail, stop rollout and restore the previously recorded known-good deployment using the approved Railway procedure.
- Re-run smoke checks and verify database/schema compatibility after rollback. A code rollback does not automatically reverse database migrations.
- Preserve the failed deployment ID, previous deployment ID, CI URL, incident timeline, and observed recovery evidence.
- On a first launch there is no prior deployment to restore: follow the first-launch incident and recovery plan instead of inventing a rollback target.

Do not force-push, bypass branch protections, or treat this document as a substitute for independently verified deployment evidence.
