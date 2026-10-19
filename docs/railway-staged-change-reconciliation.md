# Railway staged-change reconciliation gate

Use this runbook before the first production deployment of PR #11. The existing Railway environment has 14 staged legacy changes; **do not apply the batch**.

## Review each pending change

1. Export or record the currently deployed web and worker service configuration and the last known-good deployment ID. Redact all secret values.
2. For each staged change, record the affected service, setting, existing effective value, proposed value, reason, and decision (retain, replace, or discard). Treat unknown changes as blocked.
3. Compare the intended web-service settings with `railway.json`: Dockerfile build, `node scripts/production-preflight.mjs && npm run migrate` before deployment, Next.js start command, `/api/ready` health check, 120-second health-check timeout, 30-second draining, and bounded restarts.
4. Keep the legacy worker service inactive. Do not promote a legacy worker start command without a separately reviewed entrypoint and smoke test.
5. Verify the production OIDC issuer, audience and JWKS URL and the primary AI provider URL, model and secret key are configured via Railway secrets. Record only whether each is present and validated, never its value.
6. Verify database backup/restore readiness and review migrations for backward compatibility with the last known-good web image.
7. Obtain explicit release approval for the **reviewed web-only diff**. If the Railway UI cannot isolate it from legacy staged changes, stop; do not apply all pending changes as a workaround.

## Release evidence and abort criteria

Record commit SHA, green CI run, approved change decisions, target Railway environment, backup checkpoint, prior deployment ID (or first-launch marker), operator, and timestamp. Run production preflight and post-deploy liveness/readiness smoke tests, then validate release evidence with `scripts/check-production-release-evidence.mjs`.

Abort before deployment if any change is unexplained, OIDC or AI provider configuration is incomplete, migration safety is unknown, the worker is accidentally enabled, or no safe rollback/first-launch recovery path is documented.

If smoke checks or monitoring fail after deployment, restore the recorded last known-good deployment and recheck schema compatibility. On first launch, use the incident recovery plan; do not invent a rollback deployment ID.
