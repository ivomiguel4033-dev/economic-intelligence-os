# Production smoke-test execution record (Railway)

Use this record for the exact candidate commit after the Railway web deployment. This is a **manual evidence template**, not proof that a smoke test ran. Never paste bearer tokens, API keys, customer records, or raw personal data.

## Identity and prerequisites

- UTC start/end time: PENDING
- Operator and independent reviewer: PENDING
- Candidate Git SHA / successful CI run URL for that SHA: PENDING
- Railway project / environment / **web** service / deployment ID: PENDING
- Running image digest and migration version: PENDING
- Runtime preflight result and redacted evidence reference: PENDING
- Restorable PostgreSQL backup reference and compatibility decision: PENDING
- Authorized test tenant(s) and least-privilege test identities (identifiers only): PENDING
- Maximum permitted AI request count, token budget and cost: PENDING

## Tests (capture UTC time, PASS/FAIL, redacted evidence reference and reviewer)

| Gate | Expected behavior | Result | Evidence reference |
| --- | --- | --- | --- |
| Readiness | `GET /api/ready` reports healthy after migrations; failures block release | PENDING | PENDING |
| Authentication | Authorized test identity authenticates against configured production OIDC issuer/audience/JWKS | PENDING | PENDING |
| Access control | Unauthenticated access to a protected endpoint is rejected; do not expose tokens | PENDING | PENDING |
| Tenant isolation | Tenant A cannot read or mutate tenant B's protected resource using approved synthetic fixtures | PENDING | PENDING |
| AI provider | One approved, cost-bounded request succeeds using the configured model; no secrets or sensitive data logged | PENDING | PENDING |
| Observability | Protected metrics require authorization; request failures and correlation IDs appear in redacted logs | PENDING | PENDING |
| Operational stability | No material error-rate, latency or restart regression during the agreed observation window | PENDING | PENDING |

Do not use real customer data for isolation tests. Do not interpret a 200 response from readiness as evidence that OIDC, AI or tenant isolation passed. If the AI provider is unavailable, record **FAIL / NO-GO** rather than fabricating a successful test.

## Failure and recovery

- Failure detection UTC / affected deployment ID: PENDING
- Stop/rollback decision and responsible operator: PENDING
- Previous verified deployment ID **only for subsequent releases**: PENDING
- Database compatibility and restore decision: PENDING
- Recovery action and completion UTC: PENDING
- Post-recovery readiness, OIDC, tenant isolation and data integrity: PENDING

For the **first** deployment there is no verified previous deployment: record backup-based recovery, not an imaginary Railway rollback target. A code rollback does not undo destructive migrations. Refer to `docs/production-rollback-rehearsal-record.md` for later releases.

## Independent release decision

- All gates PASS, with evidence and reviewed runtime configuration? **NO** (default)
- Unresolved issues and owners: PENDING
- GO / NO-GO: **NO-GO** (default)
- Operator signature / UTC: PENDING
- Independent reviewer signature / UTC: PENDING

A green GitHub CI run alone never authorizes production deployment. This document does not replace the release evidence validator or `docs/production-first-deploy-checklist.md`.
