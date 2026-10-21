# Railway production rollback drill (no live deployment)

Use this checklist **before** approving the first production promotion in PR #11. This is an operator-run rehearsal, not an automated deployment. Do not run it against production or approve pending Railway changes without a separately reviewed change plan.

## Entry criteria

- Record the exact candidate commit SHA and a successful CI run for that SHA. If checks are pending or failing, stop.
- Confirm that `npm run test:production-smoke` passed for the exact candidate commit, including the HTTP contract and 64 KiB decoded-response boundary checks. A passing generic build alone is insufficient.
- In staging, verify that both `/api/health` and `/api/ready` are uncached end-to-end: `Cache-Control: no-store`, no positive `Age`, and no cache hit in `Cache-Status`, `X-Cache`, or `CF-Cache-Status`. Treat a cached readiness response as a release NO-GO even when HTTP 200 is returned.
- Confirm the target Railway project, environment, web service, and database by their identifiers. Review each staged Railway change; do not apply the legacy staged patch wholesale.
- Verify that the web service has the intended OIDC issuer, audience, JWKS URL and primary AI provider settings **without copying secret values** into tickets, logs or evidence files.
- Confirm a tested, restorable PostgreSQL backup and migration compatibility with the previous application image. A database rollback must not be assumed possible.
- Confirm the legacy Railway worker remains disabled until a reviewed current worker entrypoint exists; do not reactivate an obsolete worker as part of rollback.
- For an upgrade, record the previous known-good Railway deployment ID. For a first launch, explicitly record that no previous deployment exists and define a traffic-disable plan instead.

## Rehearsal in an isolated environment

1. Deploy the candidate to a non-production environment using an isolated database and test credentials. Do not reuse live identity or AI API secrets.
2. Run the production preflight with the environment's real settings: `node scripts/production-preflight.mjs`. Stop if it fails; do not weaken the gate.
3. Apply migrations to the isolated database and record their versions and completion status.
4. Execute `node scripts/production-smoke.mjs https://<staging-origin>`. Require both liveness and database readiness to pass. Separately test authenticated OIDC and an authorized AI request; the public smoke probe does **not** cover these.
5. Simulate a bad application release in staging, then restore the previous known-good application deployment using Railway's supported rollback mechanism. Do **not** revert database migrations blindly.
6. Repeat smoke, authenticated OIDC, AI checks and database compatibility checks after rollback. Capture UTC timestamps, candidate/rollback deployment IDs and outcomes, without tokens or customer data.
7. If rollback cannot restore service within the agreed recovery window, mark the release **NO-GO** and correct the procedure before any production promotion.

## Evidence and decision

- Run `node scripts/production-release-evidence-check-suite.mjs` locally to exercise the evidence regression checks. The same suite runs in `.github/workflows/ci.yml`; confirm the evidence regression gate succeeded for the exact candidate SHA. A green CI run validates the checker, not the truth of external release evidence.
- Generate a new draft using `node scripts/production-release-evidence-draft.mjs <new-file.json>`; existing evidence files must never be overwritten.
- Complete only gates backed by actual evidence and validate with `node scripts/check-production-release-evidence.mjs <file.json>`. The validator checks fields, **not** the truth of external evidence.
- Do not set `smokePassed`, `oidcVerified`, `aiVerified`, `backupVerified` or `postReleaseObservationPassed` to true based solely on a staging rehearsal. Those production gates require independent production verification.
- Keep PR #11 unmerged and production promotion on hold until Railway configuration, live verification, backup/restore and rollback conditions are satisfied.
