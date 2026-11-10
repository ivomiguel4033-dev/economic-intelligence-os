# Production release handoff — evidence worksheet

Copy this worksheet into the restricted release record for **each** candidate. This worksheet does not authorize deployment. Follow [the first-release runbook](production-first-deploy-runbook.md) for execution and rollback procedures.

## Candidate identity (complete before any change)

| Field | Recorded value |
| --- | --- |
| UTC decision time | NOT RECORDED |
| Release owner / rollback owner | UNASSIGNED / UNASSIGNED |
| PR #11 head SHA and branch HEAD SHA | NOT VERIFIED / NOT VERIFIED |
| CI workflow run URL and successful conclusion for **that SHA** | NOT VERIFIED |
| Immutable image digest and source commit | NOT VERIFIED |
| Deployed image digest from Railway runtime and comparison with approved digest | NOT VERIFIED |
| Railway project / environment / **web** service | NOT VERIFIED |
| Current live deployment ID and previous known-good image digest | NOT VERIFIED |
| Approved monitoring window and rollback thresholds | NOT APPROVED |

If branch HEAD, PR head, CI SHA or image provenance differ, invalidate this worksheet and start again. Never use a mutable tag as rollback evidence.

## External blockers and release gates

Record **PASS**, **FAIL** or **NOT RUN** for each gate, with a sanitized evidence location and approving owner. A blank or NOT RUN is **NO-GO**.

| Gate | Result | Evidence / owner |
| --- | --- | --- |
| Railway's 14 legacy staged changes individually reconciled; legacy worker inactive | NOT RUN | |
| Production OIDC issuer, audience, JWKS and invalid-token denial verified | NOT RUN | |
| OIDC JWKS outage drill in isolated environment: uncached/unknown signing keys denied, cached verified keys obey expiry policy, recovery confirmed without fail-open authentication | NOT RUN | |
| OIDC JWKS rotation rehearsal: old/new key overlap, unknown `kid` rejection, expired token rejection and recovery without disabling authentication | NOT RUN | |
| Primary AI URL, model and key configured; bounded provider smoke verified | NOT RUN | |
| AI provider failure drill: timeout abort, failover, circuit breaker and no duplicate execution/cost verified with sanitized request IDs | NOT RUN | |
| Production preflight and database-aware readiness on target deployment | NOT RUN | |
| Public HTTPS endpoint: valid certificate/hostname, enforced TLS, and no sensitive data in unauthenticated health responses | NOT RUN | |
| Runtime-deployed image digest matches CI-approved immutable digest (not just the tag) | NOT RUN | |
| Migration compatibility with previous image and tested database restore | NOT RUN | |
| Railway pre-deploy migration failure drill in isolation: nonzero migration exit blocks web promotion, existing healthy deployment remains serving, and no legacy worker starts | NOT RUN | |
| Authorized tenant A request and cross-tenant denial | NOT RUN | |
| Stripe signed event, duplicate delivery and invalid signature (test mode) | NOT RUN | |
| Error/latency/queue monitoring against approved baseline | NOT RUN | |
| Alert routing tested: on-call and rollback owner acknowledge a synthetic critical alert within the agreed response window | NOT RUN | |
| Rollback access, previous image and post-rollback smoke rehearsal | NOT RUN | |
| Post-rollback durable outbox/lease and Stripe webhook replay compatibility: isolated duplicate-event test, tenant binding, queue/dead-letter baseline, and legacy worker confirmed inactive | NOT RUN | |
| Rollback drill timing: UTC trigger, rollback start, restored readiness, first successful authenticated smoke, measured recovery duration and approved RTO comparison | NOT RUN | |
| Smoke-test command, exit status, UTC time, target environment and matching commit/image digest recorded | NOT RUN | |
| Redacted evidence artifacts checksummed (SHA-256), access-restricted and retention approved | NOT RUN | |
| Release freeze verified: no overlapping Railway deployments or unreviewed configuration changes | NOT RUN | |

## Decision and incident handoff

**Decision: NO-GO** until all required gates are PASS. Record the approving operator, UTC timestamp and exact release identity only after the final HEAD/CI/image recheck.

On any failed gate or threshold breach: stop promotion, preserve the candidate and current deployment identifiers, contact the rollback owner and record the UTC incident start. Check migrated-schema and persisted-event compatibility **before** restoring an older image. If incompatible, use the approved forward-fix or database recovery plan instead; never blindly reverse migrations or activate the legacy worker.

After recovery, record the actual active deployment ID and immutable image digest, readiness outcome, authentication/tenant-isolation smoke results, provider health, database/queue health, and UTC recovery time. Record unresolved issues and the next explicit GO/NO-GO decision. Never include secrets, JWTs, payment payloads or raw customer data in this worksheet.
