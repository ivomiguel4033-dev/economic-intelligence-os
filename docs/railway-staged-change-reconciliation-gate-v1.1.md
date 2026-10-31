# Railway staged-change reconciliation gate — v1.1

Applies to PR #11, branch `feature/production-readiness-v1.1`. **This is a hold-point, not deployment authorization.** The Railway environment has 14 legacy staged changes that must not be accepted as a batch. The old worker remains inactive.

## Snapshot before any change

Capture (in a restricted operational record) the Git commit SHA, CI run URL, Railway project/environment/service identifiers, active deployment ID, current applied configuration, and each pending staged change. Record the observation time in UTC. Redact variable values and never export secrets into Git, CI logs or screenshots.

For **each** staged change, record: resource/service, configuration key, redacted old/new value or fingerprint, source of truth, intended architecture (current web / legacy worker / unknown), operational impact, decision (keep / discard / defer), reviewer and timestamp. An unknown item is **defer**, not approval.

## Reconcile by service

1. **Web build and start:** compare pending settings with `railway.json` at the exact candidate SHA. Expected Dockerfile build, pre-deploy `node scripts/production-preflight.mjs && npm run migrate`, Next.js start, `/api/ready` health check, bounded draining and restart policy. Reject any staged command that starts the previous architecture.
2. **OIDC:** verify the presence and correct environment scoping of `OIDC_ISSUER`, `OIDC_AUDIENCE` and `OIDC_JWKS_URL`. Check issuer, audience and JWKS reachability with approved synthetic credentials; do not expose keys or tokens.
3. **Primary AI:** verify `AI_PRIMARY_BASE_URL`, `AI_PRIMARY_API_KEY` and `AI_PRIMARY_MODEL` are present on the web service. Validate the configured endpoint and a bounded synthetic request; redact prompts, credentials and provider responses in evidence.
4. **Database and migrations:** compare connection targets and migration settings with the current release contract. Require a database owner to approve compatibility and a tested recovery path before any migration-bearing deployment.
5. **Legacy worker:** leave it stopped; do not approve pending worker image, start-command, trigger or scaling changes until a current worker entrypoint and ownership are explicitly approved.
6. **Networking and domains:** check service bindings, public origin, healthcheck routing and access restrictions. Any unexpected domain or route change is a hold.

## Approval and execution

Two independent reviewers (release owner and service/database owner where applicable) must sign off the per-change ledger. Apply only individually approved settings using Railway's supported interface; discard or leave unapproved changes pending, never select **apply all**. After each approved application, re-read the actual applied state and record whether Railway triggered a redeploy. If a deployment is unexpectedly initiated, stop promotion and invoke the incident/recovery procedure.

Run production preflight against the **actual** web-service environment, then verify CI on the exact SHA. Only after configuration reconciliation, a compatible recovery plan, and explicit release authorization may the controlled deployment proceed. Run `node scripts/production-smoke.mjs <https-service-origin>` plus separate OIDC and AI synthetic checks; health alone is insufficient.

## Failure / rollback boundary

A failed reconciliation, missing external credential, unknown staged item, absent healthy rollback target, or incompatible migration means **HOLD**. Do not attempt an application-only rollback across an incompatible schema. Follow `docs/first-deployment-recovery-decision-matrix-v1.1.md` and `docs/production-rollback-evidence-v1.1.md`. Record the final decision, deployment IDs, UTC times and verification results without secrets.
