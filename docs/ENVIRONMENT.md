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
