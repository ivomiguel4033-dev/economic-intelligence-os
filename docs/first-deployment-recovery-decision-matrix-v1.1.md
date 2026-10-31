# First-deployment recovery decision matrix — v1.1

This runbook supplements `docs/production-rollback-evidence-v1.1.md` and applies to PR #11. It is a decision aid, **not** permission to deploy. In particular, the first production deployment may have **no previous healthy release** to roll back to.

## Before touching Railway

Record the exact candidate commit SHA, successful CI run URL, web-service ID, current deployment ID (if any), public origin, image digest (if available), migration IDs, and UTC timestamp in `docs/production-release-evidence-record-v1.1.md` or the approved external release record. Never commit production secrets or access tokens.

Check production preflight using the **actual** Railway web-service environment. OIDC issuer/audience/JWKS and the primary AI base URL/key/model must be configured and verified without logging credentials. Review the 14 legacy staged Railway changes individually; do not apply them wholesale. Keep the old worker inactive. Confirm database migration compatibility with the candidate **and** the previous web image.

## Decision matrix

| Observed condition | Required action | Recovery evidence |
| --- | --- | --- |
| No previously healthy deployment | **HOLD** promotion until an explicit first-release recovery plan is approved. Do not claim rollback is available. | Approved database restore/forward-fix plan, owner and recovery time objective. |
| CI, preflight, or configuration incomplete | **HOLD**; correct the source/configuration before any deployment. | Exact SHA, successful CI and redacted preflight result. |
| Migration incompatible with prior image | **HOLD**; do not attempt app-only rollback. Review backup/restore or forward-fix with database owner. | Migration assessment, tested restore procedure and owner. |
| New web deployment fails smoke | Stop promotion. If a verified compatible healthy deployment exists, use Railway's supported rollback mechanism targeting its recorded deployment ID. Otherwise invoke the approved first-release recovery plan. | Action ID, target ID (if any), UTC time and smoke exit status. |
| Smoke passes but OIDC or AI synthetic transaction fails | **HOLD**; health endpoints are not proof of identity or provider readiness. Investigate before promotion or use the compatible rollback target. | Redacted issuer/tenant checks, synthetic request result and correlation ID. |
| Rollback command succeeds but smoke/auth/AI checks fail | Keep incident **OPEN** and escalate. A successful command is not proof of service recovery. | Failed checks, incident owner and next action. |

## Controlled rehearsal (staging only)

1. Use an isolated staging service with non-production OIDC and AI credentials and a disposable database. Record a known-good web deployment ID and a compatible migration baseline.
2. Deploy a deliberately unhealthy staging candidate. Confirm the production smoke gate exits nonzero; do not simulate success by skipping readiness.
3. Restore the recorded known-good deployment using the supported Railway operation, without force-pushing Git branches or reactivating the legacy worker.
4. Re-run `node scripts/production-smoke.mjs <https-staging-origin>`, then a synthetic authenticated OIDC transaction and a synthetic AI request. Confirm expected tenant isolation and no duplicated durable side effects.
5. Record elapsed recovery time, deployment IDs, migration compatibility, all exit statuses and any manual intervention. If any check fails, mark the rehearsal failed and remediate before approving production.

## Hard stop

Do not approve production promotion without a verified recovery path, green CI on the exact SHA, reconciled Railway staging, real-environment preflight, passing smoke, and separate OIDC/AI checks. Never paste secrets into the evidence record.
