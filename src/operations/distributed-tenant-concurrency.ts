import { randomUUID } from "node:crypto";
import { db } from "@/infrastructure/database/postgres";
import { incrementMetric } from "@/observability/service-metrics";

export type DistributedTenantConcurrencyLease = {
  leaseToken: string;
  renew: () => Promise<boolean>;
  release: () => Promise<void>;
};

function configuredLimit(): number {
  const raw = process.env.ORCHESTRATION_MAX_CONCURRENCY_PER_TENANT ?? "2";
  if (!/^\d+$/.test(raw)) return 2;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 2;
}

function boundedTtlSeconds(ttlSeconds: number): number {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("Distributed tenant concurrency ttlSeconds must be a positive safe integer");
  }
  return Math.max(5, Math.min(ttlSeconds, 3600));
}

function configuredLockTimeoutMillis(): number {
  const raw = process.env.ORCHESTRATION_TENANT_LOCK_TIMEOUT_MS ?? "1000";
  if (!/^\d+$/.test(raw)) return 1000;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.max(100, Math.min(parsed, 5000))
    : 1000;
}

function validOrganizationId(organizationId: string): boolean {
  return typeof organizationId === "string"
    && organizationId.length > 0
    && organizationId.length <= 128
    && organizationId === organizationId.trim()
    && !/[\u0000-\u001f\u007f]/.test(organizationId);
}

function postgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export async function tryAcquireDistributedTenantConcurrency(
  organizationId: string,
  ttlSeconds = 120,
): Promise<DistributedTenantConcurrencyLease | null> {
  if (!validOrganizationId(organizationId)) {
    throw new Error("Distributed tenant concurrency requires a valid organizationId");
  }

  const leaseToken = randomUUID();
  const ttl = boundedTtlSeconds(ttlSeconds);
  const limit = configuredLimit();
  const lockTimeoutMillis = configuredLockTimeoutMillis();
  const client = await db.connect();
  let discardClient = false;
  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SELECT set_config('lock_timeout', $1, true)", [`${lockTimeoutMillis}ms`]);
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
      [organizationId],
    );
    await client.query(
      `DELETE FROM tenant_concurrency_leases
       WHERE organization_id=$1::uuid AND expires_at <= NOW()`,
      [organizationId],
    );
    const capacity = await client.query<{ active: number }>(
      `SELECT COUNT(*)::int AS active
       FROM tenant_concurrency_leases
       WHERE organization_id=$1::uuid AND expires_at > NOW()`,
      [organizationId],
    );

    if ((capacity.rows[0]?.active ?? limit) >= limit) {
      await client.query("COMMIT");
      transactionOpen = false;
      incrementMetric("tenant_concurrency_limited_total");
      return null;
    }

    const acquired = await client.query<{ lease_token: string }>(
      `INSERT INTO tenant_concurrency_leases (organization_id, lease_token, expires_at)
       VALUES ($1::uuid, $2::uuid, NOW() + ($3 * INTERVAL '1 second'))
       RETURNING lease_token::text AS lease_token`,
      [organizationId, leaseToken, ttl],
    );
    await client.query("COMMIT");
    transactionOpen = false;

    if (acquired.rows[0]?.lease_token !== leaseToken) {
      incrementMetric("tenant_concurrency_acquire_failures_total");
      return null;
    }
    incrementMetric("tenant_concurrency_acquired_total");
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
        transactionOpen = false;
      } catch {
        discardClient = true;
      }
    } else {
      // A failed COMMIT has an ambiguous transaction outcome. Never reuse the
      // session: the server may have committed even though the client observed
      // an error, and a follow-up ROLLBACK cannot make that outcome certain.
      discardClient = true;
    }
    if (postgresErrorCode(error) === "55P03") {
      incrementMetric("tenant_concurrency_limited_total");
      return null;
    }
    incrementMetric("tenant_concurrency_acquire_failures_total");
    throw error;
  } finally {
    client.release(discardClient);
  }

  let releasePromise: Promise<void> | undefined;
  let released = false;
  let leaseLost = false;
  return {
    leaseToken,
    renew: async () => {
      if (released || leaseLost) {
        incrementMetric("tenant_concurrency_lease_lost_total");
        return false;
      }
      try {
        const renewed = await db.query(
          `UPDATE tenant_concurrency_leases
           SET expires_at=NOW() + ($3 * INTERVAL '1 second')
           WHERE organization_id=$1::uuid
             AND lease_token=$2::uuid
             AND expires_at > NOW()
           RETURNING lease_token`,
          [organizationId, leaseToken, ttl],
        );
        if ((renewed.rowCount ?? 0) !== 1) {
          leaseLost = true;
          incrementMetric("tenant_concurrency_lease_lost_total");
          return false;
        }
        incrementMetric("tenant_concurrency_renewed_total");
        return true;
      } catch (error) {
        // A renewal error can be ambiguous: PostgreSQL may have applied the
        // UPDATE even if the client did not receive the result. Fail closed so
        // this process never continues work based on an uncertain lease.
        leaseLost = true;
        incrementMetric("tenant_concurrency_renew_failures_total");
        throw error;
      }
    },
    release: async () => {
      if (released) return;
      if (releasePromise) return releasePromise;
      releasePromise = db.query(
        `DELETE FROM tenant_concurrency_leases
         WHERE organization_id=$1::uuid AND lease_token=$2::uuid`,
        [organizationId, leaseToken],
      ).then(() => {
        released = true;
      }).catch((error) => {
        // A release error is also ambiguous: the DELETE may already have
        // committed. Prevent any subsequent renewal from treating ownership as
        // certain, while leaving release itself retryable and idempotent.
        leaseLost = true;
        incrementMetric("tenant_concurrency_release_failures_total");
        releasePromise = undefined;
        throw error;
      });
      return releasePromise;
    },
  };
}
