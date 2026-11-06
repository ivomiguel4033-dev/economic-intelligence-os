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
- [ ] Rehearse the rollback procedure in a non-production Railway environment using the supported deployment rollback action. Record the previous and restored deployment IDs, verify `/api/ready` and `/api/health` after restoration, and document the operator and elapsed recovery time. A successful rehearsal is not evidence that production rollback will be safe after incompatible database migrations.
- [ ] Establish an explicit release abort threshold and maximum recovery window with the on-call operator before deployment; if the rehearsal fails or the last known-good image/configuration cannot be identified, mark the release **no-go**.
- [ ] Confirm the production pre-deploy command is `node scripts/production-preflight.mjs && npm run migrate`. Inspect migration compatibility and backups before proceeding: rolling back code does **not** automatically roll back a database migration.
- [ ] Confirm the web service start command is `node node_modules/next/dist/bin/next start`.
- [ ] Confirm Railway gates traffic on `/api/ready` (120-second healthcheck timeout); Docker liveness uses `/api/health`. Do not substitute liveness for readiness.
- [ ] Before promotion, verify the successful CI run's `head_sha` matches the approved release SHA exactly; a green run for an older commit or another branch is not release evidence. Recheck the branch HEAD and PR #11 head immediately before deployment; if either moved, stop and reapprove the candidate.
- [ ] Confirm there is no other Railway deployment, migration, rollback or configuration change in progress for this environment. Assign one release operator and serialize production changes; if another operation is active, defer rather than race it.
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
# Refuse accidental plaintext or credential-bearing origins before probing.
case "$BASE_URL" in
  https://* ) ;;
  * ) printf 'BASE_URL must use HTTPS\n' >&2; exit 1 ;;
esac
case "${BASE_URL#https://}" in
  ""|*/*|*\?*|*\#*|*@* ) printf 'BASE_URL must be a bare HTTPS origin without credentials, path, query or fragment\n' >&2; exit 1 ;;
esac
for endpoint in ready health; do
  status=$(curl --silent --show-error --proto '=https' --tlsv1.2 --max-redirs 0 --max-time 10 --output /dev/null --write-out '%{http_code}' "$BASE_URL/api/$endpoint") || {
    printf '%s: transport or timeout failure\n' "$endpoint" >&2
    exit 1
  }
  printf '%s HTTP %s\n' "$endpoint" "$status"
  if [ "$status" != 200 ]; then
    printf '%s: expected exactly HTTP 200\n' "$endpoint" >&2
    exit 1
  fi
done
```

- [ ] The loop rejects non-HTTPS or credential-bearing origins and never follows redirects; TLS certificate verification remains enabled (do not add `--insecure`). It exits zero only when both endpoints return exactly HTTP 200; HTTP 204 and redirects are rejected. An HTTP success alone is insufficient: separately validate the health JSON contract and timestamp freshness using the existing smoke-test procedure.
- [ ] Run authorized OIDC and AI smoke checks only through approved test identities and low-cost test requests; never paste bearer tokens or provider keys into release evidence.
- [ ] Record the exact SHA, Railway deployment ID, UTC verification time, HTTP codes, response times and any failure/rollback decision in the release log. If either command fails, stop promotion and investigate before retrying.

### Strict application-level smoke gate

The HTTP status loop above is a transport precheck, **not** the final application gate. From the checked-out, CI-approved release SHA, run the repository's existing JSON-contract smoke validator against the same production origin:

```sh
# Refuse to run release evidence from the wrong checkout or Node runtime.
# Set APPROVED_SHA to the full, reviewed commit SHA recorded in the release log.
: "${APPROVED_SHA:?Set APPROVED_SHA to the full CI-approved commit SHA}"
case "$APPROVED_SHA" in
  *[!0-9a-f]*|'') printf 'APPROVED_SHA must be lowercase hexadecimal\n' >&2; exit 1 ;;
esac
[ "${#APPROVED_SHA}" -eq 40 ] || { printf 'APPROVED_SHA must be a full 40-character SHA\n' >&2; exit 1; }
[ "$(git rev-parse HEAD)" = "$APPROVED_SHA" ] || { printf 'Checkout does not match APPROVED_SHA\n' >&2; exit 1; }
[ -z "$(git status --porcelain --untracked-files=all)" ] || { printf 'Smoke validator checkout has local modifications or untracked files\n' >&2; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" = 22 ] || { printf 'Smoke validator requires Node 22\n' >&2; exit 1; }
node scripts/production-smoke.mjs "$BASE_URL"
```

- [ ] Require exit code 0 from this command **in addition to** the HTTP 200 precheck. The validator checks the health/readiness response contracts, including application and database dependency status; do not substitute a plain `curl` success.
- [ ] Run the command from a clean checkout of the approved SHA and record its exit status, UTC execution time and deployed Railway ID. Independently verify that Railway identifies the deployed image as built from the same approved SHA; a matching local checkout alone does not establish deployment provenance. On any failure, declare **NO-GO** or initiate the agreed **ROLLBACK**; do not suppress errors with `|| true`.
- [ ] The validator allows loopback HTTP for local regression tests, but production verification must always use the approved HTTPS `BASE_URL`. Do not pass credentials in the URL.

## 6. Release evidence record (one record per deployment)

Complete this record during the staffed release window. Store it in the approved operations system, not in the repository if it contains internal hostnames, account details or incident information. A blank field means **not verified**, never an implicit pass.

| Field | Required evidence |
| --- | --- |
| Candidate | Git SHA, successful CI run URL, reviewer/approval |
| Railway deployment | Service/environment, deployment ID, deployed image SHA, UTC start time |
| Configuration gate | OIDC and AI settings verified (yes/no, **no secret values**); legacy staged diff reconciled; worker inactive |
| Migration gate | Preflight result, migration outcome, backup identifier and schema compatibility decision |
| Smoke checks | UTC time, ready/health HTTP status and latency, OIDC authorized/denied outcomes, AI provider test outcome |
| Rollback readiness | Last known-good deployment ID, compatible configuration reference, rehearsal evidence and recovery window |
| Decision | GO / NO-GO / ROLLBACK, named operator, decision time, incident or follow-up reference |

Do not declare GO until every required gate has recorded evidence. A failed check must include the observed error and an explicit NO-GO or ROLLBACK decision; never replace failure evidence with a later successful retry without retaining both results.

## 7. Rollback / abort

**Abort** if preflight or migrations fail, readiness stays unhealthy, identity checks fail, tenant boundaries regress, or AI errors exceed the agreed release threshold.

1. Stop promotion/traffic to the failing deployment; preserve logs and the exact failing SHA.
2. Restore the last known-good Railway web deployment/image **and its compatible environment configuration** using the platform's supported rollback mechanism.
3. Set `APPROVED_SHA` to the **restored release SHA** (not the failed candidate), check out that exact commit in a clean Node 22 working tree, and repeat the complete **Strict application-level smoke gate** from section 5 against the restored deployment's approved HTTPS `BASE_URL`. Independently verify the restored Railway deployment/image SHA matches `APPROVED_SHA` before accepting the result. Require exit code 0, then verify authorized sign-in, expected unauthorized access and tenant-scoped smoke checks. A successful HTTP status alone does not establish database readiness after rollback. Record the restored deployment ID, SHA, UTC check time and results; if any check fails, keep the incident open and escalate rather than declaring recovery.
4. If schema changes are not backward compatible, do **not** blindly reverse migrations. Escalate to a database recovery plan based on verified backups and migration history.
5. Record incident timeline, cause, corrective action and follow-up CI coverage before retrying.

**Source of truth:** `Dockerfile`, `railway.json`, `package.json` and the current PR #11 checks. This document does not assert that external Railway/OIDC/AI settings are already present.
