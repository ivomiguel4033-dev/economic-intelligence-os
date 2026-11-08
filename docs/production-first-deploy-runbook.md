# First production web release: go/no-go and rollback

Scope: the **web** service only. This is an operator checklist, not permission to deploy. Keep the legacy Railway worker inactive until its entrypoint and ownership are verified.

## Before changing Railway

1. Record the exact Git commit SHA, CI run URL, target Railway project/environment/service, current live deployment ID, and the operator responsible. Stop if any target is ambiguous.
2. Require green CI for that **exact** SHA, including the production Docker image, in-container production preflight and smoke tests. A green run on an older SHA is not sufficient.
3. Confirm the Railway web service has production OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URL set to the intended identity provider. Verify issuer/audience/JWKS compatibility without logging tokens or secret values.
4. Confirm AI_PRIMARY_BASE_URL, AI_PRIMARY_API_KEY and AI_PRIMARY_MODEL are configured and point to the approved provider. Validate provider connectivity and credential scope without exposing the key.
5. Review Railway's **14 legacy staged changes individually** against the current architecture. Do not apply the staged patch as a batch. Record which changes are retained, discarded or replaced.
6. Confirm database connectivity, migration backup/restore plan, migration compatibility with the previously deployed application, and a tested recovery owner. Do not assume that rolling back application code reverses database migrations.
7. Capture a baseline for readiness, error rate, latency, logs, and protected metrics. Verify alerting and on-call ownership. Record the previous known-good image/deployment as the rollback target.

## Controlled release

1. Run the production preflight against the actual target environment **before** any deployment; stop on missing configuration or failure.
2. Deploy only the reviewed web image pinned to the verified commit. Do not deploy the legacy worker.
3. Check liveness and database-aware readiness, then run authenticated smoke tests for tenant isolation, identity/authorization and one bounded AI provider request. Do not put credentials or user data in CI output.
4. Compare error rate, latency and AI/provider failures with the recorded baseline. Observe through the agreed monitoring window before declaring success.

## Stop conditions and rollback

Stop promotion and initiate the approved rollback if readiness fails, migrations are unsafe, tenant authorization is incorrect, provider calls repeatedly fail, or error/latency budgets breach the agreed thresholds. Do not invent thresholds during an incident.

1. Record incident time, deployment ID, symptoms and last known-good image.
2. Stop further promotion and restore the **previous verified web deployment/image** using Railway's supported deployment controls. Do not roll back a database migration blindly.
3. Re-run readiness, authentication/tenant-isolation and AI smoke tests on the restored deployment; verify metrics return to baseline.
4. If schema incompatibility prevents application rollback, halt and follow the preapproved database recovery plan with the responsible operator. Preserve logs and evidence.
5. Document root cause, rollback result, and a new go/no-go decision before another attempt.

## Evidence to retain

Commit SHA, CI run, image identifier, preflight outcome, migration decision, sanitized smoke-test results, monitoring window, release/rollback deployment IDs, and operator sign-off.

**Default decision:** NO-GO while OIDC, AI provider or Railway staged configuration is unresolved. No automatic production deployment is authorized by this document.

## Release evidence record (copy for each attempt)

Keep this record outside public CI logs. Mark every gate **PASS**, **FAIL**, or **NOT RUN**; an empty field is not approval. Record identifiers and sanitized results only, never secrets or access tokens.

| Gate | Required evidence | Result |
| --- | --- | --- |
| Change identity | Exact commit SHA, immutable image digest, PR #11 review decision | NOT RUN |
| CI | Successful workflow run for the exact release SHA; Docker/preflight smoke steps visible | NOT RUN |
| Railway target | Project, environment, web service, current deployment ID; worker explicitly inactive | NOT RUN |
| Legacy staging | Each of the 14 old staged changes individually accepted/rejected with rationale | NOT RUN |
| Identity | OIDC issuer, audience and JWKS compatibility verified; authenticated and rejected-token checks | NOT RUN |
| AI | Primary provider base URL/model configured; bounded request succeeds; invalid credential fails closed | NOT RUN |
| Database | Backup/recovery owner, migration compatibility decision, readiness after migration | NOT RUN |
| Tenant isolation | Cross-tenant access denied using non-production test identities | NOT RUN |
| Observability | Baseline, agreed error/latency thresholds, monitoring window, responsible operator | NOT RUN |
| Rollback | Previous verified image/deployment ID, restore procedure and post-restore smoke evidence | NOT RUN |

**Decision rule:** any FAIL or NOT RUN means **NO-GO**. Do not substitute a passing build for live OIDC, provider, tenant-isolation or rollback evidence. Record the approving operator and timestamp only after all gates pass. If a migration cannot be safely reversed, explicitly verify that the prior application image remains compatible with the new schema before authorizing deployment.

## Smoke-test execution and evidence hygiene

Run these checks against the **actual candidate web deployment** after readiness becomes healthy, using dedicated non-production test tenants and identities. Record the HTTP status, timestamp, sanitized correlation/request ID, and deployment/image identifier for every case. A skipped case is **NOT RUN**, not PASS.

1. **Unauthenticated denial:** request a protected endpoint without an access token; require an explicit 401/403 response and no protected response body.
2. **Invalid identity denial:** repeat with an expired token and a token with the wrong audience/issuer; require 401/403, without exposing either token in logs or evidence.
3. **Authorized tenant access:** authenticate a least-privileged test identity in tenant A and verify a permitted read succeeds with only tenant A data.
4. **Cross-tenant isolation:** use the same identity to request tenant B's known test resource; require 403/404 and verify no tenant B data appears in body, headers or logs.
5. **AI request:** issue one small, bounded request using an approved test identity; require a successful provider-backed result within the agreed timeout. Repeat with a deliberately invalid test credential only in an isolated environment; require fail-closed behavior without credential disclosure.
6. **Recovery:** verify liveness and readiness after the tests, then inspect sanitized error rates, latency, provider failures and database connectivity against the pre-recorded baseline.

Use an approved secret store for tokens and credentials; never paste them into command-line arguments captured by shell history, CI artifacts, tickets, screenshots or PR comments. Do not perform destructive tenant tests on real customer data. If a route, test identity, baseline or approved timeout is unavailable, mark the gate **NOT RUN** and retain the NO-GO decision. After rollback, repeat at minimum steps 1–4 and 6 against the restored deployment, plus the bounded AI check when provider access is available.
