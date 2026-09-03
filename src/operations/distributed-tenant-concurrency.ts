import { randomUUID } from "node:crypto";
import { db } from "@/infrastructure/database/postgres";
import { incrementMetric } from "@/observability/service-metrics";

export type DistributedTenantConcurrencyLease = {
  leaseToken: string;
  release: () => Promise<void>;
};

function configuredLimit(): number {
  const parsed = Number.parseInt(process.env.ORCHESTRATION_MAX_CONCURRENCY_PER_TENANT ?? "2", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
}

function boundedTtlSeconds(ttlSeconds: number): number {
  return Math.max(5, Math.min(ttlSeconds, 3600));
}

function configuredLockTimeoutMillis(): number {
  const parsed = Number.parseInt(process.env.ORCHESTRATION_TENANT_LOCK_TIMEOUT_MS ?? "1000", 10);
  return Number.isFinite(parsed) ? Math.max(100, Math.min(parsed, 5000)) : 1000;
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
  if (!organizationId) throw new Error("Distributed tenant concurrency requires organizationId");

  const leaseToken = randomUUID();
  const ttl = boundedTtlSeconds(ttlSeconds);
  const limit = configuredLimit();
  const lockTimeoutMillis = configuredLockTimeoutMillis();
  const client = await db.connect();

  try {
    await client.query("BEGIN");
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

    if (acquired.rows[0]?.lease_token !== leaseToken) {
      incrementMetric("tenant_concurrency_acquire_failures_total");
      return null;
    }
    incrementMetric("tenant_concurrency_acquired_total");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original acquisition failure.
    }
    if (postgresErrorCode(error) === "55P03") {
      incrementMetric("tenant_concurrency_limited_total");
      return null;
    }
    incrementMetric("tenant_concurrency_acquire_failures_total");
    throw error;
  } finally {
    client.release();
  }

  let releasePromise: Promise<void> | undefined;
  return {
    leaseToken,
    release: async () => {
      if (releasePromise) return releasePromise;
      releasePromise = db.query(
        `DELETE FROM tenant_concurrency_leases
         WHERE organization_id=$1::uuid AND lease_token=$2::uuid`,
        [organizationId, leaseToken],
      ).then(() => undefined).catch((error) => {
        incrementMetric("tenant_concurrency_release_failures_total");
        releasePromise = undefined;
        throw error;
      });
      return releasePromise;
    },
  };
}
