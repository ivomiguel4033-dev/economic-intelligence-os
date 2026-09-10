# Environment Contract

## Required at runtime
- `DATABASE_URL`: PostgreSQL connection string.
- `OIDC_ISSUER`: HTTPS issuer URL.
- `OIDC_AUDIENCE`: expected API audience.
- `OIDC_JWKS_URL`: HTTPS JWKS endpoint.
- `SECURITY_EVENT_HASH_PEPPER`: random secret of at least 32 characters.
- `METRICS_TOKEN`: bearer token required to scrape the internal `/api/metrics` endpoint.
- `OUTBOX_WORKER_ID`: stable, non-empty identity for this runtime instance. It must be unique among concurrently running replicas and must remain unchanged for the lifetime of the instance so durable outbox claims and graceful-shutdown ownership use the same identity.

## Optional runtime tuning
- `DATABASE_POOL_MAX`: maximum PostgreSQL connections per application process. Defaults to `10`, invalid or non-integer values fall back to `10`, and valid values are capped at `50` to protect the shared database connection budget during horizontal scale-out.
- `DATABASE_POOL_MAX_LIFETIME_SECONDS`: maximum lifetime of a PostgreSQL pooled connection before controlled recycling. Defaults to `300` seconds; invalid, non-integer, or values below `60` fall back to `300`, and valid values are capped at `1800` seconds. Keep this comfortably below infrastructure or credential-rotation horizons so stale sessions are replaced without requiring a process restart.
- `DATABASE_POOL_CONNECTION_TIMEOUT_MS`: maximum wait for PostgreSQL connection acquisition/establishment. Defaults to `5000` ms; invalid, non-integer, or values below `250` fall back to `5000`, and valid values are capped at `30000` ms. Keep this finite so database degradation produces bounded failures instead of indefinitely retained application work.
- `DATABASE_POOL_IDLE_TIMEOUT_MS`: maximum time an unused pooled PostgreSQL connection is retained. Defaults to `30000` ms; invalid, non-integer, or values below `1000` fall back to `30000`, and valid values are capped at `300000` ms. This bounds idle connection retention across horizontally scaled replicas.
- `DATABASE_STATEMENT_TIMEOUT_MS`: server-side maximum execution time for an individual PostgreSQL statement. Defaults to `30000` ms; invalid, non-integer, or values below `1000` fall back to `30000`, and valid values are capped at `120000` ms. Keep this aligned with API latency budgets so pathological statements release shared pool capacity predictably.
- `DATABASE_QUERY_TIMEOUT_MS`: client-side watchdog for a PostgreSQL query when server-side cancellation is unavailable or delayed. Defaults to `35000` ms; invalid, non-integer, or values below `1000` fall back to `35000`, and valid values are capped at `125000` ms. Keep this slightly above `DATABASE_STATEMENT_TIMEOUT_MS` so PostgreSQL normally cancels the statement first while the client still has a finite upper bound during degraded database or network conditions.
- `DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS`: server-side maximum time a PostgreSQL session may remain idle while a transaction is open. Defaults to `30000` ms; invalid, non-integer, or values below `5000` fall back to `30000`, and valid values are capped at `120000` ms. Keep this bounded so abandoned transactions cannot retain locks or obstruct vacuum progress indefinitely.
- `DATABASE_LOCK_TIMEOUT_MS`: server-side maximum time a PostgreSQL statement may wait to acquire a conflicting lock. Defaults to `5000` ms; invalid, non-integer, or values below `250` fall back to `5000`, and valid values are capped at `30000` ms. Keep this well below the broader statement/query budgets so lock contention fails predictably instead of consuming request latency and pooled connections indefinitely.

## Migration safety tuning
The migration runner uses a dedicated PostgreSQL session and applies independent, bounded budgets so deployments cannot hang indefinitely on connectivity, long-running statements, lock contention, or abandoned transactions. These variables affect `scripts/migrate.mjs`, not normal application traffic.

- `MIGRATION_CONNECTION_TIMEOUT_MS`: maximum time allowed to establish the migration database connection. Defaults to `10000` ms; invalid, non-integer, or values below `250` fall back to `10000`, and valid values are capped at `60000` ms.
- `MIGRATION_STATEMENT_TIMEOUT_MS`: server-side maximum execution time for each migration statement. Defaults to `300000` ms; invalid, non-integer, or values below `1000` fall back to `300000`, and valid values are capped at `1800000` ms. The client-side migration query watchdog is derived from this value and remains only slightly higher so PostgreSQL cancellation is authoritative under normal conditions.
- `MIGRATION_LOCK_TIMEOUT_MS`: maximum time a migration statement may wait for a conflicting PostgreSQL lock. Defaults to `30000` ms; invalid, non-integer, or values below `250` fall back to `30000`, and valid values are capped at `120000` ms. Keep this materially below the statement timeout so lock contention is diagnosed as such rather than consuming the full migration execution budget.
- `MIGRATION_IDLE_IN_TRANSACTION_TIMEOUT_MS`: maximum time the migration session may remain idle while a transaction is open. Defaults to `60000` ms; invalid, non-integer, or values below `5000` fall back to `60000`, and valid values are capped at `600000` ms. This protects deploys from abandoned migration transactions retaining locks after unexpected runner failures.
- `ALLOW_MIGRATION_CHECKSUM_BASELINE`: emergency compatibility switch for controlled adoption of historical migration checksums. It is disabled unless set exactly to `true` and must never be enabled broadly or permanently.
- `MIGRATION_CHECKSUM_BASELINE_FILES`: comma-separated allowlist of the exact historical migration filenames whose missing checksums may be adopted when `ALLOW_MIGRATION_CHECKSUM_BASELINE=true`. Every listed file must exist and require adoption; unused, unknown, stale, or incomplete authorizations fail closed.

Migration timeout increases should be temporary, justified by a known migration characteristic, and reviewed before production use. Do not raise these budgets to mask lock contention, database saturation, or a migration that should be decomposed into safer steps.

## Billing when enabled
- `STRIPE_SECRET_KEY`: server-side Stripe credential.
- `STRIPE_WEBHOOK_SECRET`: webhook signing secret.

## Operational rules
- Secrets must be supplied by the deployment platform and never committed to Git.
- Production must not set `ALLOW_INSECURE_AUTH=true`.
- Development and production credentials must be different.
- Rotate a credential immediately if it appears in logs, source control, issue trackers or chat transcripts.
- Changes to identity or billing credentials require a deployment verification pass.
- Metrics scraping must use `Authorization: Bearer <METRICS_TOKEN>` and the endpoint must not be exposed without this token.
- `OUTBOX_WORKER_ID` is an instance identity, not a shared service name. Reusing it across live replicas can make durable claim ownership ambiguous; changing it during an instance lifetime can prevent graceful shutdown from observing that instance's outstanding claims.
