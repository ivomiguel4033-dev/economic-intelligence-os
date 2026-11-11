import { randomUUID } from "node:crypto";
import { db } from "@/infrastructure/database/postgres";

export type LeaseFence = { ownerId: string; fencingToken: string };

export class ExecutionLease {
  readonly ownerId = randomUUID();

  constructor(private readonly organizationId: string) {
    if (!organizationId) throw new Error("ExecutionLease requires organizationId");
  }

  async acquireWithFence(leaseKey: string, ttlSeconds = 60): Promise<LeaseFence | null> {
    const ttl = Math.max(5, Math.min(ttlSeconds, 3600));
    const result = await db.query(
      `INSERT INTO execution_leases (organization_id, lease_key, owner_id, expires_at)
       VALUES ($1,$2,$3,NOW() + ($4 * INTERVAL '1 second'))
       ON CONFLICT (organization_id, lease_key) DO UPDATE
       SET owner_id=EXCLUDED.owner_id,
           acquired_at=NOW(),
           expires_at=EXCLUDED.expires_at,
           fencing_token=execution_leases.fencing_token + 1
       WHERE execution_leases.expires_at <= NOW()
       RETURNING owner_id, fencing_token::text AS fencing_token`,
      [this.organizationId, leaseKey, this.ownerId, ttl],
    );
    const row = result.rows[0];
    if (row?.owner_id !== this.ownerId) return null;
    return { ownerId: this.ownerId, fencingToken: String(row.fencing_token) };
  }

  async acquire(leaseKey: string, ttlSeconds = 60): Promise<boolean> {
    return (await this.acquireWithFence(leaseKey, ttlSeconds)) !== null;
  }

  async renew(leaseKey: string, ttlSeconds = 60, fencingToken?: string): Promise<boolean> {
    const ttl = Math.max(5, Math.min(ttlSeconds, 3600));
    const result = await db.query(
      `UPDATE execution_leases SET expires_at=NOW() + ($4 * INTERVAL '1 second')
       WHERE organization_id=$1 AND lease_key=$2 AND owner_id=$3 AND expires_at > NOW()
         AND ($5::bigint IS NULL OR fencing_token=$5::bigint)
       RETURNING lease_key`,
      [this.organizationId, leaseKey, this.ownerId, ttl, fencingToken ?? null],
    );
    return result.rowCount === 1;
  }

  async release(leaseKey: string, fencingToken?: string): Promise<void> {
    await db.query(
      `DELETE FROM execution_leases
       WHERE organization_id=$1 AND lease_key=$2 AND owner_id=$3
         AND ($4::bigint IS NULL OR fencing_token=$4::bigint)`,
      [this.organizationId, leaseKey, this.ownerId, fencingToken ?? null],
    );
  }
}
