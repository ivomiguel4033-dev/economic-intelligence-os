# AI provider failover release verification — v1.1

This operator checklist supports PR #11. It is not evidence that Railway production secrets exist, and does not authorize deployment.

## Preconditions

- Record the intended commit SHA, environment, operator, UTC start time and last-known-good Railway deployment ID in the release evidence record.
- Confirm `AI_PRIMARY_BASE_URL`, `AI_PRIMARY_API_KEY` and `AI_PRIMARY_MODEL` are configured on the intended **web** service via approved secret management. Never print API keys, prompts containing personal data, raw provider responses or bearer tokens in CI artifacts.
- Reconcile Railway's legacy staged changes before deploying. Keep the obsolete worker inactive until a supported entrypoint is explicitly approved.
- Run the production preflight and CI suite against the intended SHA. A green CI does not validate provider credentials or outbound connectivity from Railway.

## Controlled validation (non-sensitive synthetic input only)

1. With a synthetic request and a working primary provider, confirm successful response, correct tenant binding, bounded response time and a single completed execution.
2. Induce a primary-provider timeout in a controlled test environment. Confirm the active request is aborted before fallback starts; verify no overlapping provider calls or duplicated durable side effects.
3. Simulate an upstream 429 and a 5xx separately. Confirm bounded retries/backoff, circuit-breaker transitions and the documented fallback outcome; do not assume every provider error is retryable.
4. Make every configured provider unavailable. Confirm a bounded, explicit failure, no fabricated successful answer, no leaked credentials and no stuck execution lease.
5. Recover the primary provider. Confirm circuit-breaker recovery and that a repeated request with the same idempotency key does not duplicate persisted execution or billing effects.
6. Test a disallowed provider URL or DNS resolution target in an isolated environment. Confirm outbound URL/DNS restrictions reject it **before** network access.
7. Check sanitized logs/metrics for provider choice, timeout, fallback, error class and correlation ID. Record counts and latency, never secrets or unredacted prompts.

## Promotion and rollback gate

**HOLD** if preflight fails, primary configuration is incomplete, failover overlaps an un-aborted request, tenant isolation fails, idempotency is broken, all-provider failure appears successful, or Railway staging remains unreconciled.

Only after approved configuration and change review: perform a controlled web deployment, run liveness/readiness smoke tests, then run an authenticated synthetic AI request. Health smoke tests alone do not prove AI readiness. Record deployed SHA, Railway deployment ID, observed behavior and reviewer.

If the new release causes failures, stop promotion and follow `docs/production-rollback-evidence-v1.1.md`. Verify database/schema compatibility before rollback; restore the last-known-good web deployment without reactivating the legacy worker. Re-run smoke, OIDC authentication and synthetic AI verification after recovery.

Related procedures: `docs/oidc-key-rotation-readiness-v1.1.md`, `docs/railway-staged-change-reconciliation-v1.1.md` and `docs/production-release-evidence-record-v1.1.md`.
