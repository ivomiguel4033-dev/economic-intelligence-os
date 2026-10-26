# Production smoke HTTP response contract

The release gate `node scripts/production-smoke.mjs https://<service-origin>` probes `/api/health` and `/api/ready`. Use only the intended deployment origin; a successful HTTP status by itself is insufficient.

## Required response invariants

- Both endpoints return HTTP 200 directly, without redirects or redirect/delegation hints (`Refresh`, `Location`, `X-Accel-Redirect`, `X-Sendfile` or `X-Reproxy-URL` response headers), without authentication challenges or authentication metadata (`WWW-Authenticate`, `Authentication-Info`, `Proxy-Authenticate`, `Proxy-Authentication-Info`), and without credential-dependent or wildcard `Vary` values (`Authorization`, `Proxy-Authorization`, `Cookie`, `*`); `Content-Type` must be `application/json` (optional UTF-8 charset only).
- Both endpoints must not report an upstream failure via a `Proxy-Status` `error` parameter, even with HTTP 200 and valid JSON. Informational `Proxy-Status` without errors is permitted.
- Both endpoints send `Cache-Control: no-store`. A nonzero/malformed `Age`, CDN cache hit, stale or revalidated status is a failure even if the JSON looks healthy.
- Both bodies contain valid UTF-8 JSON without duplicate object keys (including Unicode-escaped duplicates), no larger than **65,536 bytes**. The limit is inclusive; 65,537 bytes must fail. This limit applies to decoded response bytes, including when an HTTP intermediary serves gzip-compressed or chunked content; the smaller transfer size is not evidence of compliance.
- Liveness identifies `economic-intelligence-os`, status `ok` and application check `ok`.
- Readiness identifies the same service, status `ready`, database status `ok` and a finite nonnegative `latencyMs` number.

## Operator verification

1. Record the exact candidate commit and successful CI run for that commit.
2. Run `npm run test:production-smoke` against the checked-out candidate before promotion; this executes both the HTTP contract regression suite and the byte-exact 64 KiB boundary suite against local test servers, without production credentials. Confirm both suites passed.
3. Run `node scripts/production-smoke.mjs https://<service-origin>` after the controlled deployment. Capture the exit code and timestamp, not response bodies or secrets.
4. Treat any failure as **NO-GO**; follow `docs/PRODUCTION_ROLLBACK_DRILL.md` and `docs/production-readiness-gates.md`. On first launch, use traffic-disable recovery rather than claiming a previous deployment exists.

This probe does **not** verify OIDC login, AI provider calls, database backup restoration, or Railway staged-change reconciliation. Those remain separate release gates for PR #11.
