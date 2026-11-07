# Production rollback evidence checklist (v1.1)

Use this checklist during the first Railway web-service release. It complements `docs/production-release-gate-v1.1.md`; it does not authorize deployment.

## Before deployment

1. Record the current deployed Railway deployment ID, image digest, public origin and UTC time. If no prior healthy deployment exists, record **no rollback target** and do not describe rollback as available.
2. Confirm PR #11 CI is green for the exact commit SHA to deploy. Record the SHA and the successful CI run URL.
3. Run the production preflight against the **actual** web-service configuration. Confirm OIDC issuer/audience/JWKS and primary AI endpoint/key/model are present without copying secret values into logs.
4. Review the 14 legacy Railway staged changes individually. Do not apply them as a batch. Keep the legacy worker inactive until its entrypoint is reviewed.
5. Check database migration compatibility with the previous application version. If the migration is irreversible or backward-incompatible, document a restore plan and do not rely on application rollback alone.

## After deployment

1. Record the new deployment ID, image digest, SHA and UTC time.
2. Run `node scripts/production-smoke.mjs <https-origin>` against the public deployment origin; capture exit status and timestamp without credentials.
3. Check both `/api/health` and `/api/ready` through the release smoke gate. A successful liveness check alone does **not** permit promotion.
4. Verify application logs and error metrics for unexpected 5xx responses, authentication failures, database timeouts and AI-provider errors.
5. If smoke fails or critical regressions appear, stop promotion and restore the **recorded** prior deployment through the supported Railway rollback operation. Never guess an image tag or deployment ID.
6. Re-run the same smoke gate after rollback and record its result. If rollback smoke fails, mark the incident unresolved and escalate; do not declare recovery based solely on a successful Railway command.

## Evidence to retain

| Field | Required evidence |
| --- | --- |
| Candidate | Commit SHA, CI run URL, image digest |
| Baseline | Previous deployment ID and image digest, or explicit 'none' |
| Configuration | Preflight pass/fail, reviewer, timestamp; no secrets |
| Database | Migration ID, backward-compatibility assessment and restore decision |
| Release | New deployment ID, UTC timestamp, smoke exit code |
| Recovery | Rollback target ID, action result and post-rollback smoke exit code |

**Release rule:** missing baseline, incomplete configuration, failed CI/preflight/smoke or an unreviewed database migration is a **NO-GO**. This document is an operational gate, not evidence that Railway is configured or production has been deployed.
