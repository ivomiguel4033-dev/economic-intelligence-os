# First production deployment: abort without a previous release

Use this procedure only for the first deployment, when there is no known-good application revision to roll back to. This is an operational checklist, not authorization to deploy.

## Preconditions

- Record the candidate Git SHA, successful CI run, Railway environment, operator and UTC timestamp.
- Confirm the production OIDC issuer, audience and JWKS URL are configured; never record secret values.
- Confirm the primary AI provider URL, model and API key are configured; never record secret values.
- Reconcile the 14 legacy Railway staged changes individually. Do not apply the old staging patch wholesale.
- Keep the legacy worker inactive until a current worker entrypoint is explicitly approved.
- Verify the database backup and restoration procedure before any migration.

## Abort gate

If preflight, migration, `/api/health`, `/api/ready` or the production smoke probe fails:

1. Stop new external traffic at the ingress/router; do not assume a prior deployment exists.
2. Keep the old worker disabled and suspend background consumers that can mutate production data.
3. Preserve application and migration logs, failed checks, deployment SHA and UTC timestamps without credentials.
4. Do not reverse a database migration by guesswork. Follow the documented backup/restore decision with an operator.
5. Fix the fault on a new candidate and require green CI, preflight and smoke checks before restoring traffic.

## Release gate

Only restore traffic after both health and readiness are fresh, uncached HTTP 200 JSON responses, the database dependency reports ready, and `node scripts/production-smoke.mjs https://<production-origin>` passes. A 200 response alone is not sufficient. Record the final verification and incident owner.

See `docs/PRODUCTION_ROLLBACK_DRILL.md` and `docs/PRODUCTION_CACHE_STATUS_TEST_MATRIX.md` for existing rollback and cache evidence gates.
