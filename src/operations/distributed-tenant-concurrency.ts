import { randomUUID } from "node:crypto";
import { db } from "@/infrastructure/database/postgres";

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

export async function tryAcquireDistributedTenantConcurrency(
  organizationId: string,
  ttlSeconds = 120,
): Promise<DistributedTenantConcurrencyLease | null> {
  if (!organizationId) throw new Error("Distributed tenant concurrency requires organizationId");

  const leaseToken = randomUUID();
  const ttl = boundedTtlSeconds(ttlSeconds);
  const limit = configuredLimit();
  const client = await db.connect();

  try {
    await client.query("BEGIN");
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
      return null;
    }

    const acquired = await client.query<{ lease_token: string }>(
      `INSERT INTO tenant_concurrency_leases (organization_id, lease_token, expires_at)
       VALUES ($1::uuid, $2::uuid, NOW() + ($3 * INTERVAL '1 second'))
       RETURNING lease_token::text AS lease_token`,
      [organizationId, leaseToken, ttl],
    );
    await client.query("COMMIT");

    if (acquired.rows[0]?.lease_token !== leaseToken) return null;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original acquisition failure.
    }
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
        releasePromise = undefined;
        throw error;
      });
      return releasePromise;
    },
  };
}
