# Production first-deploy and rollback checklist (v1.1)

This is an operator checklist, not authorization to deploy. The PR #11 branch must pass CI and be reviewed before any production change.

## 1. Release gate

- [ ] Record the intended Git commit SHA and the corresponding successful GitHub Actions run; confirm the deployed image was built from that exact SHA.
- [ ] Run `npm run test:production-readiness` against the candidate commit (Node 22); do not treat a local pass as a substitute for CI.
- [ ] Run `npm run test:release-evidence` (included in `test:production-readiness`) and retain its pass/fail result alongside the candidate SHA. This gate validates release-evidence tooling; it does **not** prove a Railway deployment or replace post-deploy observations.
- [ ] Confirm the Railway web service is using the repository's `railway.json` and `Dockerfile` from the intended commit.
- [ ] Review Railway's pending environment/configuration diff before applying anything. The previously reported **14 legacy staged changes** must be reconciled individually; never accept the staged patch wholesale.
- [ ] Keep the legacy worker service inactive until a supported worker entrypoint is reviewed.

## 2. Required secrets and service dependencies

- [ ] Set `OIDC_ISSUER`, `OIDC_AUDIENCE`, and `OIDC_JWKS_URL` for the production identity provider. Verify issuer, audience and JWKS endpoint match the provider's actual configuration.
- [ ] Set `AI_PRIMARY_BASE_URL`, `AI_PRIMARY_API_KEY`, and `AI_PRIMARY_MODEL` for the approved provider. Verify connectivity and authorization without printing credentials.
- [ ] Verify database connectivity, required database environment variables, and least-privilege permissions for migrations and runtime.
- [ ] Keep secrets out of CI logs, PR comments, screenshots and the repository. A missing required value is a **no-go**, not a reason to bypass preflight.

## 3. Controlled release

- [ ] Record the last known-good Railway deployment/image and its configuration so rollback is possible.
- [ ] Confirm the production pre-deploy command is `node scripts/production-preflight.mjs && npm run migrate`. Inspect migration compatibility and backups before proceeding: rolling back code does **not** automatically roll back a database migration.
- [ ] Confirm the web service start command is `node node_modules/next/dist/bin/next start`.
- [ ] Confirm Railway gates traffic on `/api/ready` (120-second healthcheck timeout); Docker liveness uses `/api/health`. Do not substitute liveness for readiness.
- [ ] Deploy only the approved SHA during a staffed observation window. Record the deployment identifier and start time.

## 4. Post-deploy smoke checks

- [ ] Confirm `/api/ready` returns success after migrations and dependencies are ready; monitor readiness through the initial observation window.
- [ ] Confirm `/api/health` returns HTTP 200 with the expected JSON service, status, application check and fresh timestamp.
- [ ] Exercise one authorized OIDC sign-in and one expected unauthorized request; verify no tenant isolation regression.
- [ ] Exercise a low-cost AI request through the approved provider; verify provider failure handling without exposing request secrets.
- [ ] Review application errors, restart count, database migration output, request latency and any queue/outbox backlog before declaring success.
- [ ] Record smoke-check results, timestamps, deployment SHA and operator in the release log.

## 5. Read-only HTTP verification (operator workstation)

Run these checks against the approved production hostname after deployment. Set `BASE_URL` to the exact HTTPS origin (no path); do not put credentials or tokens in command history. These requests are unauthenticated and must not modify production data.

```sh
BASE_URL="https://<approved-production-host>"
curl --fail --silent --show-error --max-time 10 --output /dev/null --write-out 'ready HTTP %{http_code} in %{time_total}s\\n' "$BASE_URL/api/ready"
curl --fail --silent --show-error --max-time 10 --output /dev/null --write-out 'health HTTP %{http_code} in %{time_total}s\\n' "$BASE_URL/api/health"
```

- [ ] Both commands exit zero and report HTTP 200. An HTTP success alone is insufficient: separately validate the health JSON contract and timestamp freshness using the existing smoke-test procedure.
- [ ] Run authorized OIDC and AI smoke checks only through approved test identities and low-cost test requests; never paste bearer tokens or provider keys into release evidence.
- [ ] Record the exact SHA, Railway deployment ID, UTC verification time, HTTP codes, response times and any failure/rollback decision in the release log. If either command fails, stop promotion and investigate before retrying.

## 6. Rollback / abort

**Abort** if preflight or migrations fail, readiness stays unhealthy, identity checks fail, tenant boundaries regress, or AI errors exceed the agreed release threshold.

1. Stop promotion/traffic to the failing deployment; preserve logs and the exact failing SHA.
2. Restore the last known-good Railway web deployment/image **and its compatible environment configuration** using the platform's supported rollback mechanism.
3. Verify `/api/ready`, `/api/health`, sign-in and tenant-scoped smoke checks after rollback.
4. If schema changes are not backward compatible, do **not** blindly reverse migrations. Escalate to a database recovery plan based on verified backups and migration history.
5. Record incident timeline, cause, corrective action and follow-up CI coverage before retrying.

**Source of truth:** `Dockerfile`, `railway.json`, `package.json` and the current PR #11 checks. This document does not assert that external Railway/OIDC/AI settings are already present.
