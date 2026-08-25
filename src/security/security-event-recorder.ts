import { createHash } from "node:crypto";
import { db } from "@/infrastructure/database/postgres";

function digest(value?: string | null): string | null {
  if (!value) return null;
  const pepper = process.env.SECURITY_EVENT_HASH_PEPPER;
  if (!pepper) throw new Error("SECURITY_EVENT_HASH_PEPPER is not configured");
  return createHash("sha256").update(`${pepper}:${value}`).digest("hex");
}

export async function recordSecurityEvent(input: {
  eventType: string;
  outcome: "success" | "denied" | "error";
  actorId?: string;
  organizationId?: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.query(
    `INSERT INTO security_events
      (event_type, outcome, actor_id, organization_id, ip_hash, user_agent_hash, metadata, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())`,
    [
      input.eventType,
      input.outcome,
      input.actorId ?? null,
      input.organizationId ?? null,
      digest(input.ip),
      digest(input.userAgent),
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}
