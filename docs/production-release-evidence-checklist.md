# Production release evidence checklist

This checklist is an operator aid, not proof that an external deployment is healthy.

## Before promotion

1. Confirm the PR head SHA and successful GitHub Actions CI run match the candidate release.
2. Review Railway staged changes individually. Do not accept legacy staged changes as a batch.
3. Confirm OIDC issuer, audience and JWKS URL against the intended production identity provider.
4. Confirm the primary AI provider URL, API key and model are configured in Railway.
5. Verify PostgreSQL readiness, a recent restorable backup and the reviewed migration plan.
6. Execute production preflight against the target environment; stop if any check fails.

## Controlled deployment

1. Record the current Railway deployment ID before an upgrade.
2. Deploy the intended commit, then run the post-deploy smoke probe against the deployed origin.
3. Observe health, readiness, errors and latency before declaring the release complete.
4. For an upgrade, confirm the rollback deployment ID is different from the new deployment ID.
5. Record evidence using the release evidence draft and validator scripts. Never mark gates as passed without independent verification.

## Recovery

If preflight, smoke checks or observation fail, stop promotion and restore the previously verified deployment. For a first launch without a previous deployment, stop serving traffic and investigate instead of inventing a rollback target. Recheck health and readiness after recovery.

Relevant scripts: `scripts/production-preflight.mjs`, `scripts/production-smoke.mjs`, `scripts/production-release-evidence-draft.mjs`, `scripts/check-production-release-evidence.mjs`.
