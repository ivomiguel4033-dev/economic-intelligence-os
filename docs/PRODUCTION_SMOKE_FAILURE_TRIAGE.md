# Production smoke failure triage

The post-deployment gate is `node scripts/production-smoke.mjs <https://service-origin>`.
Use only the actual deployed service origin; do not append a path, query or fragment.
The probe checks `/api/health` and `/api/ready`, with a five-second request
deadline per endpoint. It requires HTTP 200, valid UTF-8 JSON, explicit
`Cache-Control: no-store`, and a fresh response with no cache-hit indicators.
Readiness must confirm a healthy database and a nonnegative numeric latency.

## If the gate fails

1. **Do not promote the release.** Preserve the failed CI/deployment URL,
   deployed commit SHA, environment, and the exact smoke error (without secrets).
2. Check the service's liveness and readiness endpoints independently.
   A healthy liveness response does not override failed database readiness.
3. For cache-related failures, inspect `Cache-Control`, `Age`,
   `Cache-Status`, `X-Cache`, `X-Cache-Status`, `CF-Cache-Status`,
   `CDN-Cache-Control`, and `Surrogate-Control`. Fix caching at the
   origin **and** any proxy/CDN; do not disable the smoke assertion.
4. For readiness failures, inspect database connectivity, migration status,
   and service logs. Do not treat a successful build as deployment evidence.
5. For redirects, incorrect content types, invalid JSON, or timeouts,
   correct the deployed route or ingress before retrying the gate.

## Rollback decision

If the candidate cannot pass both probes within the approved release window,
roll back to the last known-good deployed version using the hosting platform's
normal rollback mechanism. Record the previous and restored deployment IDs.
Run the same smoke gate against the restored service origin; rollback is not
verified until both liveness and database readiness pass.

## Production prerequisites

Do not deploy while production OIDC or primary AI provider configuration is
incomplete, or while legacy Railway staged changes and the obsolete worker
service remain unresolved. Validate the actual Railway environment with
`node scripts/production-preflight.mjs` before controlled promotion.
Never paste API keys or OIDC secrets into logs or incident reports.
