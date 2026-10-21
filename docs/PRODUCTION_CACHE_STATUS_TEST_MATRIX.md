# Production smoke: Cache-Status release matrix

This is a release-gate checklist for PR #11. It does not authorize a deployment.

The smoke probe must reject a cache hit on either `/api/health` or `/api/ready`, even when HTTP status is 200, `Age` is absent and `Cache-Control` contains `no-store`.

| Cache-Status response | Expected smoke outcome |
| --- | --- |
| `edge; hit` | FAIL |
| `edge; fwd=uri-miss` | PASS if all other checks pass |
| `edge; fwd=uri-miss, shield; hit` | FAIL |
| No `Cache-Status` header | PASS if all other checks pass |

Run `npm run test:production-smoke` on the candidate SHA. In staging, run `node scripts/production-smoke.mjs https://<staging-origin>` and inspect both endpoints. Do not promote if the cache policy is not verified end to end. Record the candidate SHA, CI run, staging timestamp and probe result without credentials. Follow `docs/PRODUCTION_ROLLBACK_DRILL.md` for recovery evidence.

This matrix does not replace production OIDC, primary AI provider, Railway staging reconciliation, database backup or rollback gates.
