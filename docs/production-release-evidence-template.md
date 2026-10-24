# Production release evidence template

Copy this record for each proposed Railway release. Never record secrets, tokens or customer data.

| Gate | Evidence / reference | Result |
| --- | --- | --- |
| Candidate commit SHA and PR #11 | | PASS / FAIL |
| CI run for the exact candidate SHA | | PASS / FAIL |
| Railway staged changes reviewed | | PASS / FAIL |
| Production preflight (real environment) | | PASS / FAIL |
| OIDC issuer, audience and JWKS verified | | PASS / FAIL |
| Primary AI provider configured and tested | | PASS / FAIL |
| PostgreSQL deployment and backup verified | | PASS / FAIL |
| Migration compatibility reviewed | | PASS / FAIL |
| Known-good application deployment ID, if any | | PASS / FAIL / FIRST LAUNCH |
| Upgrade rollback target verified as restorable and schema-compatible (`rollbackVerified`) | | PASS / FAIL / FIRST LAUNCH |
| Independent HTTPS liveness and readiness smoke | | PASS / FAIL |
| Authentication negative test (wrong issuer/audience) | | PASS / FAIL |
| Post-release error/readiness observation | | PASS / FAIL |

## Go/no-go decision

- **NO-GO** if any required gate fails, any required OIDC/AI setting is missing, or Railway contains unreviewed staged changes.
- For an initial launch without a known-good deployment, record **FIRST LAUNCH** instead of claiming rollback capability.
- Record the rollback deployment ID before an upgrade. Application rollback does not reverse database migrations; verify schema compatibility and backup recovery separately.
- Capture the decision maker, UTC timestamp, deployed SHA, Railway deployment ID and the reason for the final GO or NO-GO decision.

Decision: **NO-GO / GO**  
Decision maker:  
UTC timestamp:  
Deployment ID:  
Reason:  
