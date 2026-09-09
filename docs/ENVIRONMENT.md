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
