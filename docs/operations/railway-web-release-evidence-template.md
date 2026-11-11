# Railway web release evidence record

Copy this template into the approved private release/incident tracking system for **each** production deployment. Do not commit a completed record containing credentials, tokens, tenant identifiers, or customer data. A green CI run is necessary but not sufficient for a GO decision.

## Identity and approval

- Release date/time (UTC):
- Operator and independent approver:
- PR: https://github.com/ivomiguel4033-dev/economic-intelligence-os/pull/11
- Reviewed branch HEAD (full SHA):
- GitHub Actions run URL, conclusion, and checked SHA:
- Railway environment / web service:
- Candidate deployment ID and immutable image digest (verified against reviewed CI build):
- Previous known-good deployment ID, commit SHA, image digest:
- Previous configuration snapshot location (restricted access):

## Preconditions (record PASS, FAIL or NOT VERIFIED, plus evidence reference)

| Gate | Result | Evidence reference |
| --- | --- | --- |
| CI successful for the exact reviewed SHA | | |
| Deployment image digest matches the reviewed CI artifact and intended Railway web revision (no mutable-tag-only evidence) | | |
| Railway pending configuration diff reconciled individually; no legacy staged batch | | |
| Legacy worker remains inactive | | |
| OIDC issuer, audience, JWKS configured and validated without exposing secrets | | |
| Primary AI endpoint, key and model configured and validated without exposing secrets | | |
| AI provider failure-mode drill passed in isolated pre-production (timeout, rate limit, invalid response); no production fault injection | | |
| Production preflight passed in target environment | | |
| Database backup verified and restore procedure rehearsed | | |
| Migrations reviewed for compatibility with previous application version | | |
| Previous deployment and configuration can be restored | | |

**Decision before deployment:** GO / NO GO

- Approver and time:
- If any gate is FAIL or NOT VERIFIED, decision must be NO GO.

## Deployment and smoke evidence

- Deployment start/end time (UTC):
- Railway deployment URL/ID (restricted if necessary):
- `GET /api/health` (liveness) HTTP status and time:
- `GET /api/ready` (database readiness) HTTP status and time:
- Verify both endpoints return **HTTP 200**, not redirects or another 2xx status; capture their response times separately. If readiness is non-200, mark the release **HOLD** or **ROLLBACK** rather than treating liveness as sufficient.
- During the observation window, repeat readiness after the initial healthy response; record any regression to non-200, its duration, and the deployment decision. Never record credentials, response bodies, or tenant identifiers in the evidence.
- OIDC negative authentication smoke: missing token, invalid signature, wrong issuer, and wrong audience must each be denied; record expected/actual HTTP status and UTC time using approved synthetic tokens only (never log tokens):
- OIDC key-rotation readiness: verify the documented JWKS refresh/recovery path and issuer availability without changing production signing keys; record evidence or NOT VERIFIED:
- Unauthenticated protected request: denied as expected (status, time):
- Authorized protected request: passed (status, time; no response payload):
- Tenant isolation validation: passed (test reference; no tenant data):
- Cross-tenant negative smoke: authenticated principal for tenant A must be denied access to a tenant B resource; record only expected/actual HTTP status, UTC time and test reference (never tenant IDs or resource contents):
- Verify the negative smoke cannot mutate data; use an approved read-only fixture and stop on any unexpected access grant:
- Minimal approved AI provider request: passed (latency/status; no prompt or credentials):
- Pre-production AI failure-mode drill reference: record isolated environment, tested timeout/429/malformed response, expected bounded retry/failover or controlled error, actual result, and confirmation that requests were aborted without duplicate side effects or leaked secrets. Never deliberately break the live production provider:
- Observation window start/end (UTC), agreed minimum duration, and monitoring dashboard/reference:
- Pre-deploy baseline and approved rollback thresholds for 5xx rate, p95 latency, database errors, and AI-provider failures (include units and measurement window):
- Observed values for each threshold during the window, including source and UTC timestamp; mark missing telemetry as NOT VERIFIED:
- Error rate, latency, database and AI-provider metrics observation interval:
- Any threshold breach: time, incident reference, HOLD/ROLLBACK decision, and approver:
- Smoke test operator:
- Post-deploy decision: ACCEPT / ROLLBACK / HOLD

## Rollback record (complete even if not invoked)

- Rollback trigger / threshold:
- Operator authorized to restore the previous web deployment:
- Previous deployment and configuration restoration procedure/reference:
- Database schema compatibility with previous application confirmed: YES / NO
- Rollback invoked: YES / NO
- If invoked: start/end UTC, restored deployment ID, readiness/authenticated/denied smoke results:
- If previous binary is incompatible with migrated schema: stop and use the approved database recovery plan; never improvise destructive SQL.
- Incident/reference and final approver:

Refer to `docs/operations/railway-web-release-rollback-gate.md` for the release decision and abort policy. Never trigger deployment solely because this template is filled in.
