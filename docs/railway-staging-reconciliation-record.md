# Railway production staging reconciliation record

Use this record **before** applying any staged Railway configuration. The production environment previously contained 14 legacy staged changes; that historical count is not a live inventory. Recount and review the actual pending changes at execution time.

## Read-only inventory (no deployment)

- UTC timestamp, operator, independent reviewer:
- Railway project, environment and web service identifiers (no secrets):
- Git candidate SHA and successful CI run URL for the same SHA:
- Current running deployment ID and health:
- Pending change count and change identifiers:
- Current web service Dockerfile/build and start settings:
- Current pre-deploy command and migration entrypoint:
- Current health-check path/timeout and drain period:
- Worker service status and entrypoint (keep legacy worker inactive):
- PostgreSQL backup restore evidence and migration compatibility assessment:

Record each staged change in a separate row. Do **not** approve the entire staged set by default.

| Change ID | Service | Setting (name only) | Current vs proposed (redacted) | Intended architecture? | Impact / rollback plan | Reviewer decision |
| --- | --- | --- | --- | --- | --- | --- |
| PENDING | PENDING | PENDING | REDACTED | PENDING | PENDING | REJECT / DEFER / APPROVE |

## Security and dependency gates

1. Confirm the production web service has valid OIDC issuer, audience and JWKS URL. Verify issuer/JWKS trust and audience using an authenticated smoke test; do not record tokens.
2. Confirm the primary AI base URL, model and API key are present using the runtime preflight and a cost-bounded request; do not print or copy credentials.
3. Compare the intended web service configuration to `railway.json` at the **exact** candidate SHA. Check the Docker build, `node scripts/production-preflight.mjs && npm run migrate`, `/api/ready`, health-check timeout and drain period.
4. Check that the worker is not accidentally activated by staged changes. A legacy worker without a reviewed entrypoint is a deployment blocker.
5. Verify a restorable database backup and review schema compatibility with both the candidate and recovery application version. A code rollback does not reverse a migration.

## Decision and execution boundaries

- **NO-GO:** Any unreviewed staged change, unknown worker behavior, absent OIDC/AI configuration, missing backup-restore evidence, failed preflight or failed CI for the candidate SHA. Leave staged changes unapplied.
- **GO candidate:** Every intended change has a separate reviewer approval, dependencies are verified, and a documented recovery owner and procedure exist. Approval to reconcile configuration is **not** approval to deploy.
- Apply only the individually approved changes through the normal Railway controls; never accept the legacy patch wholesale. Capture the resulting configuration identifiers and audit timestamps without secret values.
- Re-run runtime preflight after configuration reconciliation. A successful CI preflight alone does not prove that Railway runtime configuration works.
- Before any web deployment, use `docs/production-first-deploy-checklist.md` and the release evidence validator. For later releases, rehearse rollback using `docs/production-rollback-rehearsal-record.md`.
- If unexpected service changes, failing readiness or authentication/AI regressions occur, stop, preserve redacted diagnostics and use the approved recovery procedure. Never claim a rollback succeeded without post-recovery checks.

## Sign-off

- Reconciliation outcome: PENDING (APPROVED / DEFERRED / REJECTED)
- Remaining staged changes and owners: PENDING
- Production deployment authorized separately? **NO** by default
- Operator signature / UTC time: PENDING
- Independent reviewer signature / UTC time: PENDING
