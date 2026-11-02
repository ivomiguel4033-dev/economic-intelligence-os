# Production rollback rehearsal record

Use this template for an isolated, non-destructive rehearsal before subsequent production releases. Never include secrets, tokens, personal data or database credentials.

- Candidate commit SHA: PENDING
- Previous deployment ID and SHA: PENDING
- Railway environment/service: PENDING
- Operator and independent reviewer: PENDING
- UTC start/end time: PENDING
- Approved RTO / observed recovery time: PENDING
- Approved RPO / observed restore point: PENDING
- Database migration version and backward compatibility: PENDING
- Previous image retrievable and starts against compatible schema: PENDING
- Readiness endpoint after recovery: PENDING
- Authenticated OIDC and tenant-isolation smoke tests: PENDING
- Cost-bounded AI provider smoke test: PENDING
- Return to candidate image tested: PENDING
- Evidence references (redacted): PENDING
- Final GO/NO-GO decision and reviewer approval: PENDING

A green CI run does not establish rollback readiness. A failed check or missing approved RTO/RPO is NO-GO until independently resolved. Reverting application code never automatically reverts database migrations.

For a first deployment, there is no previous Railway deployment to roll back to. Rehearse restoration from a tested backup in an isolated environment instead, document its limitations and keep `rollbackVerified=false` in release evidence.
