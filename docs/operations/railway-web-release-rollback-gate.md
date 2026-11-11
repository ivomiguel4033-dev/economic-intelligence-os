# Production release and rollback gate (Railway web)

This checklist is deliberately manual. A green CI run is **not** authorization to deploy.
Do not apply the 14 legacy staged Railway changes as a batch, and do not enable the
legacy worker service without a reviewed current worker entrypoint.

## Before approving a release

1. Confirm the release commit SHA equals the reviewed PR head and all required
   GitHub Actions checks succeeded for **that SHA**. Stop if checks are pending,
   cancelled, or failing.
2. Review the Railway **web** service's pending configuration diff one setting at
   a time. Discard or separately reconcile unrelated legacy staged changes.
   Confirm Dockerfile build, `/api/ready` traffic healthcheck, bounded drain,
   pre-deploy preflight and migrations, and the intended web start command.
3. Configure `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL`,
   `AI_PRIMARY_BASE_URL`, `AI_PRIMARY_API_KEY`, and `AI_PRIMARY_MODEL`
   in Railway's protected environment settings. Never print secrets into CI,
   tickets, terminal logs, or this repository. Verify issuer/JWKS reachability
   and AI provider credentials using the approved secure process.
4. Confirm the production database backup/restore procedure has been tested,
   the latest backup is available, and the migration is backward-compatible
   with the previously deployed application. **A code rollback does not undo
   schema migrations.** Stop if compatibility is unproven.
5. Record the current healthy Railway deployment ID, image/commit SHA, and
   deployment configuration snapshot in the release record. Identify the
   operator authorized to restore that exact deployment.
6. Before GO, perform a non-destructive rollback dry run: verify that the
   recorded previous deployment remains selectable in Railway, its required
   configuration snapshot is accessible to the authorized operator, and the
   previous binary is compatible with the post-migration schema. Record the
   rehearsal time, operator, evidence reference, and expected recovery time.
   Do not actually switch production traffic during this rehearsal. A missing
   deployment, inaccessible snapshot, or unverified schema compatibility is
   NO GO.

## Controlled deployment

1. Run the production preflight with real Railway configuration, then deploy
   **only** the reviewed web service revision. Keep the legacy worker inactive.
2. Wait for Railway's `/api/ready` to report healthy; check `/api/health`
   separately for process liveness. A liveness success alone does not prove
   database readiness.
3. From an authorized client, smoke-test a valid authenticated request and a
   denied unauthenticated request. Confirm tenant isolation, expected API
   responses, and a minimal approved AI-provider request without logging its
   credentials or sensitive response data.
4. Inspect error rate, latency, readiness transitions, database connectivity,
   migration results, and AI-provider failures during the observation window.
   Do not promote the release if these checks are unavailable or inconclusive.

## Abort and rollback

- Abort immediately on failing readiness, unexpected authorization behavior,
  tenant leakage, persistent 5xx errors, or unsafe migration behavior.
- Restore the recorded previous **web deployment and configuration** through
  Railway's supported rollback/redeploy mechanism; do not force-push Git or
  bypass branch protections. Do not automatically roll back database schema.
- Recheck `/api/ready`, authentication denial, an authorized smoke request,
  and application error metrics after restoration.
- If the previous binary cannot operate against the migrated schema, stop
  traffic changes and follow the approved database recovery procedure with
  the responsible operator; do not improvise destructive SQL.
- Record timestamps, deployment IDs, observed failures, mitigation, and final
  smoke-test outcomes in the release incident record.

**Release rule:** missing OIDC, AI provider settings, Railway reconciliation,
backup confidence, smoke-test evidence, or a viable rollback path means
**NO GO**, regardless of CI status.
