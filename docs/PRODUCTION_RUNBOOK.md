# Production Runbook

## Health contract
- `/api/health` proves the application process is alive.
- `/api/ready` proves the application can reach PostgreSQL.
- A deployment must not receive production traffic while readiness returns HTTP 503.

## Operational metrics
- `/api/metrics` exposes Prometheus-format service metrics and must remain protected by `METRICS_TOKEN`.
- Never expose the metrics endpoint publicly without authentication or place `METRICS_TOKEN` in logs, dashboards, incident notes, or client-side configuration.
- Outbox metrics are aggregate operational signals. They must not include event payloads, customer content, or per-tenant labels that could leak tenant identity or create unbounded metric cardinality.

### Transactional outbox SLO thresholds
The runtime publishes the configured thresholds together with binary breach gauges. Production defaults are deliberately conservative starting points and should be tuned from measured traffic rather than relaxed during an incident.

| Signal | Environment variable | Default | Breach condition |
| --- | --- | ---: | --- |
| Ready backlog | `OUTBOX_SLO_READY_BACKLOG` | 100 messages | ready messages >= threshold |
| Failed messages | `OUTBOX_SLO_FAILED_MESSAGES` | 10 messages | failed messages >= threshold |
| Oldest ready age | `OUTBOX_SLO_OLDEST_READY_AGE_SECONDS` | 300 seconds | oldest ready message age >= threshold |
| Dead-letter | none | zero tolerance | any dead-lettered message |

Alert on `outbox_slo_backlog_breached`, `outbox_slo_failed_breached`, `outbox_slo_oldest_ready_age_breached`, and `outbox_slo_dead_letter_breached` when their value is `1`. Dead-letter is page-worthy because automatic retry has been exhausted. Backlog, failed-message, and age breaches should page when sustained long enough to exclude a short deployment or traffic spike; the monitoring platform owns that hold duration.

### Outbox incident response
1. Confirm `/api/ready` and database health before restarting workers. Do not create duplicate concurrent dispatchers as a first response.
2. Check ready backlog, oldest-ready age, processing count, failed count, dead-letter count, and the corresponding breach gauges.
3. Correlate structured logs by `organizationId`, `executionRunId`, `messageId`, worker, event type, and attempt count. Do not copy event payloads or customer content into incident records.
4. If backlog or age is breached, determine whether dispatch throughput, downstream availability, database contention, or stuck claims are responsible before changing capacity.
5. If failures are breached, group by event type and safe error code. Fix the common cause before forcing retries.
6. If dead-letter is non-zero, treat each message as requiring explicit diagnosis. Preserve the original record and audit trail; never delete or mutate it merely to clear the alert.
7. Before replaying or manually redriving work, verify the destination operation is idempotent and tenant-scoped. Use the existing execution/message identity; do not manufacture a second logical event.
8. After recovery, require backlog and oldest-ready age to return below threshold, failed/dead-letter counts to be understood, and delivery logs to show normal progression before closing the incident.

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
