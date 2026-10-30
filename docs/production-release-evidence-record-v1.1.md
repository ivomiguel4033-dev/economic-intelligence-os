# Production release evidence record — v1.1

Use one copy per proposed release or rollback of PR #11. This is an **operator worksheet**, not deployment authorization. Store the completed record in the approved incident/change-management system, not in Git if it contains infrastructure identifiers.

## Immutable identity

- UTC timestamp and operator:
- Change/incident ticket and approving reviewer:
- PR #11 URL and reviewed commit SHA:
- CI run URL, commit SHA, completed status and conclusion:
- Railway project / environment / web-service identifiers:
- Candidate deployment ID and immutable image digest:
- Last-known-good deployment ID and immutable image digest:
- Public HTTPS origin (no credentials, query string or path):

## Configuration attestation (values must never be copied here)

For each entry record **present / verified / missing**, secret-store reference (not value), and verifier:

| Runtime dependency | Status | Secret-store reference | Verified by |
| --- | --- | --- | --- |
| OIDC_ISSUER, OIDC_AUDIENCE, OIDC_JWKS_URL | | | |
| AI_PRIMARY_BASE_URL, AI_PRIMARY_API_KEY, AI_PRIMARY_MODEL | | | |
| DATABASE_URL and migration permissions | | | |
| Production security baseline and metrics access | | | |

- Railway staged-change review ticket and disposition of **each** legacy change:
- Legacy worker confirmed inactive (yes/no, evidence):
- Migration version and backward-compatibility review:
- Restore prerequisites and recovery owner:

## Promotion evidence

- Exact approved commit SHA equals CI SHA (yes/no):
- CI completed successfully (yes/no):
- Deployed image digest equals approved digest (yes/no):
- Smoke command: `node scripts/production-smoke.mjs <public-https-origin>`
- Smoke execution UTC time, exit code and sanitized log reference:
- Both liveness and database readiness passed (yes/no):
- Monitoring / alert baseline and observation window:
- Reviewer decision: **HOLD** or **APPROVE** (never infer approval from an empty field):
- Explicit deployment authorization ticket and approver:

**HOLD** if any field required for the applicable gate is missing, CI is pending/failed, the deployed digest differs, smoke fails, secrets are unverified, or Railway staged changes remain unreconciled. Never deploy just because this form is filled in.

## Rollback evidence (complete if rollback is considered or executed)

- Trigger and first observed UTC time:
- Previous immutable image digest/deployment availability verified:
- PostgreSQL schema compatibility verdict and reviewer:
- If incompatible, approved database recovery plan and owner (do not roll back application alone):
- Railway rollback authorization, operator and UTC time:
- Restored deployment ID and image digest:
- Post-rollback smoke UTC time, exit code and sanitized log reference:
- Post-rollback liveness **and** readiness result:
- Metrics recovery and incident closure approval:

Do not expose API keys, OIDC tokens, database passwords, raw authorization headers, or production secrets in evidence. See `docs/production-smoke-failure-triage-v1.1.md`, `docs/production-rollback-evidence-v1.1.md` and `docs/railway-staged-change-reconciliation-v1.1.md` for the corresponding procedures.
