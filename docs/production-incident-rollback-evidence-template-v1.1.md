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
- Railway staged configuration review: compare pending changes against the last known-good deployment; record the reviewer and explicitly discard or quarantine unrelated legacy staged changes before rollback or redeploy. Never apply the staged patch as part of recovery without a separate approved change record:
- Database migration compatibility: identify migrations applied after the last known-good release; confirm the restored application can safely use the current schema (or record the tested forward-fix plan and approver):
- Migration rollback stop gate: if schema compatibility is unverified or incompatible, do not switch traffic to the old application image; keep the incident open and obtain approval for a tested forward-fix or compatible recovery deployment:
- Post-recovery monitoring: record the baseline and observed 5xx rate, readiness failures, database errors, queue/outbox backlog and AI/OIDC dependency errors over a defined observation window; name the on-call owner and escalation threshold:
- Data safety decision: do not automatically reverse database migrations or restore a database snapshot; record backup/PITR availability, potential data loss, and explicit authorization before any destructive recovery:
- Railway rollback operation ID and completion time:
- Independently verified restored image SHA:
- Smoke command run from a clean checkout of the restored SHA with Node.js 22:
- Liveness, readiness, database dependency and smoke outcomes:
- Confirm public ingress and routing (production hostname, TLS, and any reverse proxy) reach the restored deployment; a passing internal health endpoint alone is insufficient:
- Verify a representative read-only user journey through the public endpoint, with expected HTTP status and no sensitive response content in evidence:
- Tenant isolation smoke gate: using two approved synthetic tenants and non-privileged test identities, confirm tenant A cannot read tenant B resources through the public endpoint; record only status codes and sanitized request IDs. A cross-tenant success response is an immediate stop/rollback escalation, not a warning:
- If routing, DNS, or edge caching changed during the incident, record the observed target and cache behavior before declaring recovery:
- OIDC authentication and AI provider checks (only when configured; mark blocked otherwise):
- For OIDC, use a designated non-privileged test identity; verify valid-token acceptance and invalid/expired-token rejection without recording tokens or claims containing personal data:
- For AI, use an approved low-cost synthetic request with a unique idempotency key; record provider outcome, timeout/failover behavior and duplicate-execution check without storing prompts, credentials or model responses:
- If OIDC or AI is unavailable, record the exact failed dependency and owner; do not mark the full production recovery gate as passed based solely on liveness/readiness:
- User impact resolved at (UTC), monitoring window and owner:

## Closure
- Evidence links (CI, Railway events, redacted logs, smoke output):
- Follow-up issue / regression test:
- Outstanding external blockers (OIDC issuer/audience/JWKS, AI provider, Railway staged changes):
- Reviewer sign-off and UTC closure time:

**Stop rule:** A rollback is not complete merely because Railway reports success. Keep the incident open until the restored image SHA is independently matched to the tested checkout and the full smoke gate passes. If the gate fails, escalate rather than claiming recovery.
