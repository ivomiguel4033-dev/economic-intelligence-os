# Environment Contract

## Required at runtime
- `DATABASE_URL`: PostgreSQL connection string.
- `OIDC_ISSUER`: HTTPS issuer URL.
- `OIDC_AUDIENCE`: expected API audience.
- `OIDC_JWKS_URL`: HTTPS JWKS endpoint.
- `SECURITY_EVENT_HASH_PEPPER`: random secret of at least 32 characters.

## Billing when enabled
- `STRIPE_SECRET_KEY`: server-side Stripe credential.
- `STRIPE_WEBHOOK_SECRET`: webhook signing secret.

## Operational rules
- Secrets must be supplied by the deployment platform and never committed to Git.
- Production must not set `ALLOW_INSECURE_AUTH=true`.
- Development and production credentials must be different.
- Rotate a credential immediately if it appears in logs, source control, issue trackers or chat transcripts.
- Changes to identity or billing credentials require a deployment verification pass.
