# Environment Contract

## Required at runtime
- `DATABASE_URL`: PostgreSQL connection string.
- `OIDC_ISSUER`: HTTPS issuer URL.
- `OIDC_AUDIENCE`: expected API audience.
- `OIDC_JWKS_URL`: HTTPS JWKS endpoint.
- `SECURITY_EVENT_HASH_PEPPER`: random secret of at least 32 characters.
- `METRICS_TOKEN`: bearer token required to scrape the internal `/api/metrics` endpoint.
- `OUTBOX_WORKER_ID`: stable, non-empty identity for this runtime instance. It must be unique among concurrently running replicas and must remain unchanged for the lifetime of the instance so durable outbox claims and graceful-shutdown ownership use the same identity.

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
