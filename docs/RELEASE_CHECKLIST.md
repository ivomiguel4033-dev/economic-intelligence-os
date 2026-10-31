# Production Release Checklist

## Before deployment
- CI is green on the exact release SHA.
- Database migrations are ordered and reviewed for backward compatibility.
- Required production secrets are configured outside the repository.
- OIDC issuer, audience and JWKS URL use the intended production identity provider.
- PostgreSQL automated backups are enabled and a restore test has been completed.
- `/api/health` and `/api/ready` contracts are understood by the hosting platform.

## Deployment
- Deploy one immutable release SHA.
- Do not route production traffic until `/api/ready` returns HTTP 200.
- Record deployment SHA and UTC timestamp.
- Verify authentication, tenant isolation and one non-destructive orchestration request.
- Verify structured logs contain request IDs and no authorization headers or secrets.

## Rollback triggers
Rollback immediately for cross-tenant access, authentication bypass, repeated database corruption/errors, uncontrolled external execution, or sustained readiness failure.

## After deployment
- Confirm error rate and database health.
- Confirm billing webhooks are accepted idempotently.
- Confirm security events are being recorded.
- Confirm no unexpected secret or PII exposure in logs.
- Keep the previous known-good release available until the observation window is complete.
