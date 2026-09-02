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

  const result = await db.query(
    `WITH tenant_lock AS (
       SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))
     ),
     expired AS (
       DELETE FROM tenant_concurrency_leases
       USING tenant_lock
       WHERE organization_id=$1 AND expires_at <= NOW()
     ),
     capacity AS (
       SELECT COUNT(*)::int AS active
       FROM tenant_concurrency_leases, tenant_lock
       WHERE organization_id=$1 AND expires_at > NOW()
     ),
     acquired AS (
       INSERT INTO tenant_concurrency_leases (organization_id, lease_token, expires_at)
       SELECT $1, $2, NOW() + ($3 * INTERVAL '1 second')
       FROM capacity
       WHERE active < $4
       RETURNING lease_token
     )
     SELECT lease_token::text AS lease_token FROM acquired`,
    [organizationId, leaseToken, ttl, limit],
  );

  if (result.rows[0]?.lease_token !== leaseToken) return null;

  let released = false;
  return {
    leaseToken,
    release: async () => {
      if (released) return;
      released = true;
      await db.query(
        `DELETE FROM tenant_concurrency_leases
         WHERE organization_id=$1 AND lease_token=$2`,
        [organizationId, leaseToken],
      );
    },
  };
}
