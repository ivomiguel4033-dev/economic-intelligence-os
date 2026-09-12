# Production Runbook

## Health contract
- `/api/health` proves the application process is alive.
- `/api/ready` proves the application can reach PostgreSQL.
- A deployment must not receive production traffic while readiness returns HTTP 503.

## Operational metrics
- `/api/metrics` exposes Prometheus-format service metrics and must remain protected by `METRICS_TOKEN`.
- Never expose the metrics endpoint publicly without authentication or place `METRICS_TOKEN` in logs, dashboards, incident notes, or client-side configuration.
- Outbox and database-pool metrics are aggregate operational signals. They must not include event payloads, customer content, or per-tenant labels that could leak tenant identity or create unbounded metric cardinality.

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

## Distributed tenant concurrency
These counters are deliberately aggregate-only: `tenant_concurrency_acquired_total`, `tenant_concurrency_limited_total`, `tenant_concurrency_acquire_failures_total`, and `tenant_concurrency_release_failures_total`. Never add organization or tenant identifiers as Prometheus labels; use structured logs for scoped diagnosis.

1. Persistent `tenant_concurrency_limited_total` growth means the global per-tenant limit is actively shedding orchestration load. Confirm whether this is legitimate demand, a stuck execution, or leases surviving because cleanup failed before raising concurrency limits.
2. Acquisition failures are fail-closed and directly affect availability. Confirm PostgreSQL readiness, pool saturation, advisory-lock waits, transaction errors, and the `tenant_concurrency_leases` table before changing application capacity.
3. A release failure can temporarily consume capacity until the lease expires. The default lease TTL is 120 seconds and is bounded to 5-3600 seconds; do not manually delete active leases unless their ownership and expiry are understood.
4. Correlate the aggregate alert with structured application logs and request IDs. Tenant identity belongs in protected logs, not metric labels or alert annotations.
5. Do not bypass the distributed guard with a local in-memory limiter during an incident; that breaks cross-replica enforcement and can violate tenant isolation guarantees.
6. If database recovery is required, preserve the fail-closed behavior. Prefer restoring PostgreSQL availability over weakening the concurrency boundary.
7. Close the incident only after acquisition/release failures stop increasing, saturation returns to the expected traffic baseline, and readiness remains healthy.

## PostgreSQL pool saturation
`database_pool_waiting` greater than zero means callers are queued waiting for a database connection. A brief spike can occur during traffic bursts or deploy transitions; sustained waiters indicate capacity pressure, leaked/slow connections, lock contention, or downstream queries holding the pool too long.

1. Confirm the alert is sustained and compare `database_pool_waiting`, `database_pool_total`, and `database_pool_idle`. Do not increase pool size as the first response.
2. Check database CPU, memory, connection limits, active sessions, lock waits, and slow queries. Correlate with `database_failures_total` and application latency.
3. If idle is zero and waiters remain positive, identify long-running queries and transactions before adding application capacity. The configured query and transaction timeouts are safety bounds, not substitutes for diagnosis.
4. Avoid restarting multiple instances simultaneously; that can create a connection storm and worsen saturation.
5. If a single deployment introduced the pressure, prefer application rollback over destructive database changes.
6. Increase pool capacity only after confirming PostgreSQL has safe connection headroom and the root cause is genuine concurrency demand rather than leaked or blocked work.
7. Close the incident only after waiters return to zero under normal traffic and readiness remains healthy.

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
