# Railway staged-change reconciliation — production v1.1

This is a **NO-DEPLOY** inventory procedure for PR #11. It does not apply staged changes, alter secrets, or authorize the legacy worker.

## Capture a read-only baseline

1. Identify the intended Railway project, environment, web service and legacy worker by their actual IDs. Record the UTC time, current deployed image digest, deployment ID, public web origin and migration version. Do not guess IDs.
2. Export or inspect the **14 legacy staged changes** in Railway's pending-change view. Record each change individually in the table below; the expected count is a historical observation, not proof of the current count. If the count differs, stop and reconcile the discrepancy before proceeding.
3. Compare each proposed change with the current repository deployment configuration and the *currently deployed* service configuration. Mark every change as **retain**, **discard**, or **defer**. Unreviewed changes are **defer** by default.
4. Have a second reviewer verify the complete inventory before applying any approved changes. Never accept the entire pending patch as a shortcut.

| Change ID / service / field | Current value (redacted) | Pending value (redacted) | Decision | Reason / reviewer |
| --- | --- | --- | --- | --- |
| Fill one row per actual staged change | | | defer | |

## Required service checks

- **Web build:** Docker build context, Dockerfile, image entrypoint and runtime command must match the current branch; do not restore an obsolete command from the staged patch.
- **Pre-deploy:** verify the current migration command and database target; record the migration baseline and backward-compatibility assessment before enabling it.
- **Health:** check the readiness endpoint and grace/drain settings; public liveness alone is insufficient for promotion.
- **OIDC:** verify the intended issuer, audience and JWKS URL at runtime. Record only presence, hostname and validation outcome, never tokens or secrets.
- **AI:** verify primary provider base URL, model and API-key presence at runtime; never include the key in exports, diffs or issue comments.
- **Worker:** keep the legacy worker inactive. A new entrypoint, its queue contract and independent CI evidence require a separate explicit review.
- **Database:** preserve private Railway networking where intended; never replace a working private database endpoint with a public endpoint to satisfy an unrelated web-origin check.

## Decision and evidence gate

Record the reviewed change count, decisions, reviewers, timestamp and any unresolved differences. If a pending change affects a secret, record only its **name and presence**. If an unexpected deletion, service recreation, environment switch or migration change appears, stop and escalate instead of applying it.

Only after **every** staged change is accounted for may the operator execute the real-environment production preflight described in `docs/production-release-gate-v1.1.md`. The exact PR #11 head must have green CI, and the rollback baseline and database compatibility evidence in `docs/production-rollback-evidence-v1.1.md` must be complete before a controlled web-only deployment. After deployment, run the production smoke gate against the actual HTTPS origin. A failed gate is **NO-GO**; preserve evidence and follow the reviewed rollback procedure.

**Status:** this file is a template, not a completed Railway inventory. No environment changes or deployments are implied.
