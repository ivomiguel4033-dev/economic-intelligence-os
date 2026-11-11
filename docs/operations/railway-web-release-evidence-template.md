# Railway web release evidence record

Copy this template into the approved private release/incident tracking system for **each** production deployment. Do not commit a completed record containing credentials, tokens, tenant identifiers, or customer data. A green CI run is necessary but not sufficient for a GO decision.

## Identity and approval

- Release date/time (UTC):
- Operator and independent approver:
- PR: https://github.com/ivomiguel4033-dev/economic-intelligence-os/pull/11
- Reviewed branch HEAD (full SHA):
- GitHub Actions run URL, conclusion, and checked SHA:
- Railway environment / web service:
- Candidate deployment ID and image digest:
- Previous known-good deployment ID, commit SHA, image digest:
- Previous configuration snapshot location (restricted access):

## Preconditions (record PASS, FAIL or NOT VERIFIED, plus evidence reference)

| Gate | Result | Evidence reference |
| --- | --- | --- |
| CI successful for the exact reviewed SHA | | |
| Railway pending configuration diff reconciled individually; no legacy staged batch | | |
| Legacy worker remains inactive | | |
| OIDC issuer, audience, JWKS configured and validated without exposing secrets | | |
| Primary AI endpoint, key and model configured and validated without exposing secrets | | |
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
- Unauthenticated protected request: denied as expected (status, time):
- Authorized protected request: passed (status, time; no response payload):
- Tenant isolation validation: passed (test reference; no tenant data):
- Minimal approved AI provider request: passed (latency/status; no prompt or credentials):
- Error rate, latency, database and AI-provider metrics observation interval:
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
