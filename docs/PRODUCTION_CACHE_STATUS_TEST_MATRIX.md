# Production smoke: Cache-Status release matrix

This is a release-gate checklist for PR #11. It does not authorize a deployment.

The smoke probe must reject a cache hit on either `/api/health` or `/api/ready`, even when HTTP status is 200, `Age` is absent and `Cache-Control` contains `no-store`.

| Cache-Status response | Expected smoke outcome |
| --- | --- |
| `edge; hit` | FAIL |
| `edge; hit=?1` | FAIL (explicit RFC 9211 true Boolean; not yet covered by the current smoke parser) |
| `edge; hit=?0` | PASS if all other checks pass (explicit false Boolean) |
| `edge; fwd=uri-miss` | PASS if all other checks pass |
| `edge; fwd=uri-miss, shield; hit` | FAIL |
| `edge; fwd=uri-miss, shield; HIT` | FAIL (case-insensitive) |
| `edge; hit` on `/api/ready` | FAIL even if `/api/health` passes |
| No `Cache-Status` header | PASS if all other checks pass |

Run `npm run test:production-smoke` on the candidate SHA. In staging, run `node scripts/production-smoke.mjs https://<staging-origin>` and inspect both endpoints. Do not promote if the cache policy is not verified end to end. Record the candidate SHA, CI run, staging timestamp and probe result without credentials. Follow `docs/PRODUCTION_ROLLBACK_DRILL.md` for recovery evidence.

This matrix does not replace production OIDC, primary AI provider, Railway staging reconciliation, database backup or rollback gates.

## Manual gate for explicit Boolean cache hits

Until the automated smoke parser and regression suite recognize `Cache-Status: edge; hit=?1`, verify that neither health endpoint is served from cache using the edge/CDN response metadata. Do not promote a candidate if a `hit=?1` response is observed, even if the current smoke script exits successfully. Record the CDN result and the candidate SHA as release evidence; treat this as an open automation gap rather than an automated passing check.
