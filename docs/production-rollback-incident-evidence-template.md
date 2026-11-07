# Production rollback and incident evidence template

Copy this template into the approved private incident/change record for each production deployment. **Do not commit filled records or secrets.** This is a decision aid, not an automated rollback.

## Deployment identity

- UTC start time:
- Operator and incident commander:
- PR: #11 (or successor)
- Candidate commit SHA:
- Successful CI run URL **for that SHA**:
- Railway project / environment / service (non-secret identifiers):
- Candidate deployment ID:
- Previous known-good deployment ID (upgrades only):
- Database backup identifier, timestamp and restore owner:

## Before promotion — go/no-go

- [ ] CI passed for the exact candidate SHA.
- [ ] Production preflight and migrations completed successfully.
- [ ] OIDC issuer, audience and JWKS validated in target environment.
- [ ] Primary AI provider reachable with bounded test request.
- [ ] Database backup verified and migration compatibility reviewed.
- [ ] Smoke tests passed; readiness endpoint `/api/ready` healthy.
- [ ] Recovery owner and observation window confirmed.
- Decision (GO / NO-GO), approver and UTC time:

**First deployment:** no previous production release exists. Mark rollback deployment **not applicable**, never “verified”. Document containment (disable ingress / stop rollout), database restoration prerequisites and escalation contacts. Do not assert that restoring an earlier application version is possible.

**Upgrade:** confirm the previous deployment ID is distinct from the candidate and is still available. Document backward-compatible schema assumptions. A Railway application rollback does not automatically undo database migrations.

## Detection and decision

- Trigger (readiness failure / smoke failure / auth / tenant isolation / AI / error rate / latency / DB):
- First observed UTC time:
- Evidence links (redacted logs, metrics, smoke result):
- Impact and affected tenants:
- Decision threshold and time budget:
- Decision maker, UTC time and action (CONTINUE / HALT / ROLLBACK / RESTORE):

## Recovery execution (operator-controlled)

1. Halt further promotion and capture the current deployment and migration state.
2. For upgrades only, select the verified previous Railway deployment; confirm schema compatibility **before** rolling back the application.
3. For first launches, use the approved containment/restore plan rather than claiming an unavailable deployment rollback.
4. If data restoration is necessary, obtain explicit authorization, isolate writers and follow the tested database restore procedure. Never assume that reverting code reverses a migration.
5. Re-run readiness, authenticated OIDC and tenant-isolation checks, bounded AI request and critical read/write smoke tests.
6. Record post-recovery error rate, latency, database connections and observation interval.

## Closure

- Final active deployment ID and commit SHA:
- Database state / migrations applied:
- Recovery action and exact UTC timestamps:
- Post-recovery smoke results and evidence URLs:
- Residual risks, incident owner and follow-up issue:
- Closure approver and UTC time:

**Stop condition:** if rollback target, database compatibility or credentials cannot be verified, do not improvise or bypass production gates; escalate to the incident commander.
