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
npm ci                        # Use the committed lockfile
npm run typecheck
npm run build
npm run test:production-smoke
node scripts/check-production-release-evidence.mjs --self-test
```

Record the commit SHA, command exit codes, CI run URL and test environment. A successful local smoke regression is **not** proof that production OIDC, AI, PostgreSQL or Railway configuration works. After deployment, independently check `/api/ready` on the actual service and exercise an authenticated tenant-isolated workflow and a bounded AI request. Do not place bearer tokens, API keys, request bodies containing sensitive data or database connection strings in release evidence.

If any check fails, stop promotion, preserve the failing job/command output (redacted), identify the owner and rerun against the corrected commit. Never copy a successful result from an earlier SHA.

## 5. Rollback decision

- **First launch:** there is no previous known-good production deployment. Do not claim a verified rollback deployment or mark `rollbackVerified=true`. Define an incident containment and restore plan (including database recovery) before proceeding.
- **Upgrade:** identify a **different**, known-good Railway deployment ID; verify that rollback is actually possible before approval. Confirm schema compatibility; reverting application code alone may not reverse migrations.
- On failed readiness, smoke tests, or unacceptable error/latency: stop rollout, invoke the approved recovery plan, verify readiness and data integrity, and record the incident and deployment IDs.
- Never force-push, bypass branch protections, or activate the legacy worker as a recovery shortcut.

## External blockers

Production OIDC and primary AI credentials, Railway staged-change reconciliation, and a verified recovery strategy require operator/environment access. Passing CI does **not** establish that these external conditions are satisfied.
