# Production first deployment — operator checklist

This checklist is a **manual release gate**, not permission to deploy. Use it with PR #11 and the repository's production preflight and release-evidence validator. Record evidence in the approved release record; do not store secrets in GitHub.

## 1. Verify the candidate

- [ ] Confirm PR #11 is reviewed, mergeable, and its exact commit SHA matches the candidate image.
- [ ] Confirm all required GitHub Actions checks are successful **for that SHA**; a green run for an earlier commit does not count.
- [ ] Confirm the production Docker image was built and smoke-tested by CI.
- [ ] Confirm the database migration plan, expected schema changes, backup status, and recovery owner.
- [ ] Confirm the on-call operator, change window, and explicit go/no-go decision.

## 2. Reconcile Railway without deploying

- [ ] Inspect the existing **14 legacy staged Railway changes individually**. Do not accept the staged patch as a batch.
- [ ] Keep the legacy worker service inactive until a current worker entrypoint is defined and tested.
- [ ] Configure production `OIDC_ISSUER`, `OIDC_AUDIENCE`, and `OIDC_JWKS_URL`; validate issuer/audience/JWKS against the actual identity provider.
- [ ] Configure `AI_PRIMARY_BASE_URL`, `AI_PRIMARY_API_KEY`, and `AI_PRIMARY_MODEL`; test the intended provider without logging credentials.
- [ ] Verify production PostgreSQL connectivity and migration credentials using the least privileges necessary.
- [ ] Review Railway's resolved service settings against `railway.json`: Docker build, pre-deploy preflight/migrations, `/api/ready` health check, draining, and restart policy.
- [ ] Run production preflight against the **actual target environment**. Stop if it fails; do not bypass it.

## 3. Execute and observe

- [ ] Capture the deployment ID, commit SHA, CI run URL, migration outcome, and operator approval.
- [ ] Deploy only after the above gates pass. Watch Railway deployment events and application logs.
- [ ] Confirm liveness and database-aware readiness, then exercise authenticated OIDC flow, tenant isolation, and a bounded AI request.
- [ ] Run smoke tests for critical read/write flows, migration compatibility, and expected metrics/logging.
- [ ] Observe error rate, latency, database connections, and external AI failures throughout the agreed observation window.
- [ ] Record evidence with `scripts/check-production-release-evidence.mjs` and retain the exact input file securely.

## 4. Reproducible smoke-test evidence (before approval)

Run these checks against the **exact candidate commit**, in a controlled environment, before the production go/no-go decision. They do not replace authenticated end-to-end tests against the deployed Railway URL.

```sh
node --version                 # Must satisfy package.json: >=22 <23
if [ -f package-lock.json ]; then
  npm ci --ignore-scripts
else
  npm install --ignore-scripts --no-audit --no-fund
fi                            # Match the CI dependency-install path
npm run test:production-readiness  # Typecheck, smoke regressions, evidence checks, Railway config, build
```

When no committed lockfile is present, `npm install` resolves dependency versions at execution time and is not a reproducible install; record the resolved dependency versions and do not treat a previous CI result as proof for a different install. Once a lockfile is committed, prefer `npm ci` for deterministic installs. The consolidated command runs `test:production-smoke`, including the release-evidence input regression, validator self-test, and Railway configuration regression. The negative-path evidence tests must pass; the validator self-test alone is not a substitute. Stop on any nonzero exit code. Do not mark external OIDC, AI or Railway gates verified based on this command.

Record the commit SHA, command exit codes, CI run URL and test environment. A successful local smoke regression is **not** proof that production OIDC, AI, PostgreSQL or Railway configuration works. After deployment, independently check `/api/ready` on the actual service and exercise an authenticated tenant-isolated workflow and a bounded AI request. Do not place bearer tokens, API keys, request bodies containing sensitive data or database connection strings in release evidence.

If any check fails, stop promotion, preserve the failing job/command output (redacted), identify the owner and rerun against the corrected commit. Never copy a successful result from an earlier SHA.

## 5. Release evidence field mapping (manual approval)

The evidence validator accepts a strict JSON object; it does **not** query GitHub, Railway, the identity provider or the AI provider. An exit code of zero confirms the record's shape and declared gates, **not** the truth of those declarations. Before signing off, the operator must independently verify the supporting evidence:

| Evidence fields | Required independent proof |
| --- | --- |
| `commitSha`, `ciRunUrl`, `ciPassed` | Full 40-character deployed commit SHA and a successful CI run for that same SHA in this repository. |
| `stagedChangesReviewed` | Review record for each of the 14 legacy staged Railway changes; no blanket acceptance. |
| `preflightPassed`, `postgresReady`, `migrationReviewed`, `backupVerified` | Target-environment preflight output, database connectivity, migration review and recoverable backup evidence. |
| `oidcVerified`, `aiVerified` | Successful target-environment OIDC/JWKS checks and bounded primary-AI request without exposing credentials. |
| `smokePassed`, `postReleaseObservationPassed` | Post-deployment authenticated smoke results and completed monitoring window, not just local tests. |
| `railwayDeploymentId` | Actual candidate deployment identifier from Railway. |
| `firstLaunch`, `rollbackDeploymentId`, `rollbackVerified` | First launch: `true`, omit rollback ID, `false`. Upgrade: `false`, distinct verified previous deployment ID, `true`. |

Only run the evidence validator on the completed, privately retained JSON record **after** post-release observation. Never set a gate to `true` merely to make validation pass. Keep the record and redacted supporting logs in the approved private change system, not the repository.

## 6. Rollback decision

- **First launch:** there is no previous known-good production deployment. Do not claim a verified rollback deployment or mark `rollbackVerified=true`. Define an incident containment and restore plan (including database recovery) before proceeding.
- **Upgrade:** identify a **different**, known-good Railway deployment ID; verify that rollback is actually possible before approval. Confirm schema compatibility; reverting application code alone may not reverse migrations.
- On failed readiness, smoke tests, or unacceptable error/latency: stop rollout, invoke the approved recovery plan, verify readiness and data integrity, and record the incident and deployment IDs.
- Never force-push, bypass branch protections, or activate the legacy worker as a recovery shortcut.

## External blockers

Production OIDC and primary AI credentials, Railway staged-change reconciliation, and a verified recovery strategy require operator/environment access. Passing CI does **not** establish that these external conditions are satisfied.
