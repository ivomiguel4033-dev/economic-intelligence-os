# Production smoke failure triage — v1.1

This runbook applies to PR #11 release candidates. **No deployment or rollback is authorized by this document alone.** Treat any failed or missing smoke evidence as a release gate failure.

## Evidence required before promotion

Record the immutable Git commit SHA, CI run URL and conclusion, Railway project/environment/service IDs, deployment ID, image digest, database migration version, UTC probe time, and the exact public HTTPS origin. Do not record access tokens, OIDC secrets, AI provider keys, cookies or raw authorization headers.

Run the repository's production smoke command against the **actual deployed origin** only after CI passes. Save the exit code and sanitized output. An HTTP 200 from liveness alone is never sufficient: readiness must also pass. Do not replace either check with a screenshot or an unauthenticated curl response that bypasses the repository validator.

## Fail-closed decision matrix

| Observation | Release decision | Next action |
| --- | --- | --- |
| CI pending or cancelled | HOLD | Wait for an authoritative completed result; do not create competing commits while CI runs. |
| CI failed | HOLD | Inspect the failed job and logs, correct the root cause, then require a fresh green CI run. |
| Liveness fails, redirects or responds with stale/cache evidence | HOLD | Check routing, TLS, CDN/cache configuration and the deployed SHA. Do not weaken smoke assertions. |
| Liveness passes; readiness fails | HOLD | Inspect database connectivity, migration status and dependency readiness without exposing secrets. |
| Both probes pass but deployed digest differs from approved release | HOLD | Reconcile the actual deployment with the approved immutable image. |
| OIDC issuer/audience/JWKS or AI provider runtime validation missing | HOLD | Validate runtime configuration through approved secret-management channels; never commit credentials. |
| Railway has unreviewed staged changes | HOLD | Reconcile each change independently using the staged-change runbook before any apply. |
| All gates pass with recorded evidence | ELIGIBLE FOR REVIEW | Require explicit release authorization; this table is not permission to deploy. |

## Rollback decision and verification

1. Before promotion, identify the last known-good **deployment ID and image digest** and verify that it remains available. A branch name or mutable tag is not a rollback target.
2. Compare the current and previous database schema. If migrations are not backward compatible, **stop**: reverting only the application image can corrupt data or break reads. Obtain a reviewed database recovery plan.
3. On a confirmed post-deploy incident, freeze further releases, capture the failing deployment's logs and metrics, and follow the approved Railway rollback procedure. Never restore the legacy worker as a shortcut.
4. Re-run the same liveness **and** readiness smoke gate against the restored public origin. Record exit code, deployment ID, digest, migration state, incident timeline and approver.
5. If rollback smoke fails, keep the incident open and escalate. Do not mark recovery complete based only on Railway's deployment status.

**Evidence standard:** missing, contradictory or unverifiable evidence means HOLD, not PASS.
