# Production Runbook

## Health contract
- `/api/health` proves the application process is alive.
- `/api/ready` proves the application can reach PostgreSQL.
- A deployment must not receive production traffic while readiness returns HTTP 503.

## Database recovery
1. Stop write traffic or place the service in maintenance mode.
2. Identify the last known-good PostgreSQL backup and its timestamp.
3. Restore into an isolated database first; never overwrite production as the first recovery action.
4. Run all migrations in numeric order and validate schema integrity.
5. Execute tenant-boundary and permission regression checks.
6. Point a staging instance at the restored database and verify `/api/ready`.
7. Promote only after integrity checks succeed and document the recovery point objective actually achieved.

## Deployment rollback
- Keep the previous known-good application release available for immediate rollback.
- Roll back application code before attempting destructive database changes.
- Database migrations must be forward-compatible with the previous application release whenever practical.

## Incident minimums
Capture request ID, deployment SHA, UTC timestamps, affected organization IDs, relevant structured logs, database status, and remediation actions. Do not place access tokens, passwords, raw authorization headers, or customer secrets in incident records.

## Backup policy baseline
Production PostgreSQL must have automated backups and point-in-time recovery where supported. Recovery is not considered operational until a restore has been tested. Backup existence alone is insufficient.
