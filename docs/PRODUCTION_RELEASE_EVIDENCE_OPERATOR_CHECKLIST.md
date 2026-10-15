# Production release evidence — operator checklist

This checklist records evidence; it does **not** establish that Railway, OIDC, AI, or PostgreSQL are healthy. A release remains **NO-GO** until each gate is verified against the target production environment.

## Before deployment

1. Confirm PR #11 and the exact commit SHA have a successful CI run. Record the real run URL, not a guessed value.
2. Review any staged Railway changes individually. Do not apply the legacy staged patch as a batch.
3. Verify production OIDC issuer, audience, and JWKS URL, and the primary AI provider URL, key, and model. Do not commit credentials.
4. Confirm PostgreSQL connectivity, backup/restore readiness, migration review, and the previous deployment ID for an upgrade.
5. Run the independent local evidence checks:

```sh
node scripts/production-release-evidence-check-suite.mjs
node scripts/production-release-evidence-regression.mjs
```

These checks are local only until explicitly added to the CI workflow.

## Record actual deployment evidence

Create a private draft without overwriting existing evidence:

```sh
node scripts/production-release-evidence-draft.mjs ./release-evidence.json
```

The draft deliberately defaults all checks to false and `firstLaunch` to null. Fill each field only after verifying it. For an upgrade, `rollbackDeploymentId` must identify a real previous deployment; first launches must not claim one.

After deployment, perform authenticated OIDC and AI smoke tests, check readiness and database health, observe error rates, and exercise the documented rollback procedure. Then validate the completed record:

```sh
node scripts/check-production-release-evidence.mjs ./release-evidence.json
```

A failed check means **NO-GO**. Keep private evidence and secrets out of Git. If rollback fails or the preflight is not green, stop the release and escalate; do not waive a gate.
