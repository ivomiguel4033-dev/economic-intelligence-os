# Production release evidence — operator guide

This is a manual, fail-closed release gate. A passing CI run does not prove Railway, OIDC, AI providers or PostgreSQL are production-ready. Do not mark checks true without independently collected evidence.

## Pre-deployment
1. Confirm the target commit equals PR #11's head and its CI run succeeded. Never promote while CI is running.
2. Review Railway pending changes and service readiness for web, worker and PostgreSQL. Confirm required environment variables without logging secrets.
3. Execute `node scripts/production-preflight.mjs` in the target environment. Verify OIDC issuer, audience and JWKS; verify AI provider credentials and connectivity.
4. Verify PostgreSQL readiness, restorable backup and migration compatibility. CI migrations against a temporary database do not prove production safety.

## Post-deployment
1. Record the actual Railway deployment ID. Execute deployed health/readiness, authenticated OIDC and AI smoke checks. Inspect logs and error rates.
2. Observe the release before marking post-release observation successful.
3. For an upgrade, record a prior Railway deployment ID and independently verify that the target can be restored and remains database/schema compatible; set `rollbackVerified: true` only after that check. For first launch, set `firstLaunch: true`, leave `rollbackVerified: false`, and do not invent a rollback target.
4. Create a JSON evidence record with `commitSha` (40 hex characters), `ciRunUrl` (this repository's Actions run), `railwayDeploymentId`, `firstLaunch`, and these boolean gates: `ciPassed`, `stagedChangesReviewed`, `preflightPassed`, `oidcVerified`, `aiVerified`, `postgresReady`, `backupVerified`, `migrationReviewed`, `smokePassed`, `postReleaseObservationPassed`. Upgrades also require `rollbackDeploymentId` and `rollbackVerified: true`; the validator cannot independently prove the rollback target is usable.
5. Run `node scripts/check-production-release-evidence.mjs path/to/evidence.json`. Exit code 0 checks completeness only; it does not verify external evidence. Preserve independent evidence in operational records.

## Failure and rollback
If any gate fails, stop promotion. Do not manufacture passing evidence. For a faulty upgrade, roll back to the previously verified Railway deployment, confirm database compatibility, and rerun smoke checks. For first launch, stop exposure until the failed dependency is resolved.

## Regression check
Run `node scripts/production-release-evidence-regression.mjs` locally. It is not automatically enforced by CI unless explicitly added to the workflow.
