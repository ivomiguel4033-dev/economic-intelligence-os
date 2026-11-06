# Production incident and rollback evidence template (v1.1)

Use this record for each failed first deployment, smoke-test gate, or rollback. Store it in the incident tracker, not in Git: it may contain operational metadata. Never paste credentials, bearer tokens, customer data, or complete environment dumps.

## Release identity
- Incident ID / UTC start time:
- Operator and second reviewer:
- GitHub PR #11 approval URL:
- Approved full 40-character commit SHA:
- CI run URL and successful conclusion:
- Railway project / environment / web service (names only):
- Railway deployment ID and deployed image SHA:
- Pre-deploy migration run ID / result:

## Gate failure
- First failing gate (preflight, migration, readiness, liveness, smoke, OIDC, AI):
- UTC timestamp and sanitized evidence URL:
- Expected result vs actual result:
- HTTP status / bounded error code (no response bodies containing secrets):
- Impact and decision owner:

## Rollback authorization and execution
- Decision time (UTC), approver, and reason:
- Last known-good deployment ID and full image SHA:
- Confirm no concurrent deployment, migration, or configuration change:
- Railway rollback operation ID and completion time:
- Independently verified restored image SHA:
- Smoke command run from a clean checkout of the restored SHA with Node.js 22:
- Liveness, readiness, database dependency and smoke outcomes:
- OIDC authentication and AI provider checks (only when configured; mark blocked otherwise):
- User impact resolved at (UTC), monitoring window and owner:

## Closure
- Evidence links (CI, Railway events, redacted logs, smoke output):
- Follow-up issue / regression test:
- Outstanding external blockers (OIDC issuer/audience/JWKS, AI provider, Railway staged changes):
- Reviewer sign-off and UTC closure time:

**Stop rule:** A rollback is not complete merely because Railway reports success. Keep the incident open until the restored image SHA is independently matched to the tested checkout and the full smoke gate passes. If the gate fails, escalate rather than claiming recovery.
