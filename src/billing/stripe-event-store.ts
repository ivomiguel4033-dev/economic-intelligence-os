import { createHash } from "node:crypto";
import { db } from "@/infrastructure/database/postgres";

export interface StripeEventEnvelope {
  id: string;
  type: string;
  livemode: boolean;
  rawPayload: string;
}

export async function registerStripeEvent(event: StripeEventEnvelope): Promise<"new" | "duplicate"> {
  const payloadHash = createHash("sha256").update(event.rawPayload).digest("hex");
  const result = await db.query(
    `INSERT INTO billing_webhook_events (stripe_event_id, event_type, livemode, payload_hash)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (stripe_event_id) DO NOTHING
     RETURNING stripe_event_id`,
    [event.id, event.type, event.livemode, payloadHash],
  );

  if (result.rowCount) return "new";

  const existing = await db.query<{
    event_type: string;
    livemode: boolean;
    payload_hash: string;
  }>(
    `SELECT event_type, livemode, payload_hash
     FROM billing_webhook_events
     WHERE stripe_event_id=$1`,
    [event.id],
  );
  const persisted = existing.rows[0];

  if (!persisted) {
    throw new Error(`Stripe event ${event.id} conflicted but could not be reloaded`);
  }

  if (
    persisted.event_type !== event.type ||
    persisted.livemode !== event.livemode ||
    persisted.payload_hash !== payloadHash
  ) {
    throw new Error(`Stripe event ${event.id} replay does not match the persisted event`);
  }

  return "duplicate";
}

export async function markStripeEventProcessed(eventId: string): Promise<void> {
  await db.query(
    `UPDATE billing_webhook_events SET processed_at=now(), processing_error=NULL WHERE stripe_event_id=$1`,
    [eventId],
  );
}

export async function markStripeEventFailed(eventId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 2000) : "Unknown billing event error";
  await db.query(
    `UPDATE billing_webhook_events SET processing_error=$2 WHERE stripe_event_id=$1`,
    [eventId, message],
  );
}
