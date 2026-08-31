import { createHash } from "node:crypto";
import { db } from "@/infrastructure/database/postgres";

export interface StripeEventEnvelope {
  id: string;
  type: string;
  livemode: boolean;
  rawPayload: string;
}

export type StripeEventRegistration =
  | { status: "new" | "retry"; generation: number }
  | { status: "duplicate" };

export async function registerStripeEvent(event: StripeEventEnvelope): Promise<StripeEventRegistration> {
  const payloadHash = createHash("sha256").update(event.rawPayload).digest("hex");
  const result = await db.query<{ processing_generation: string | number }>(
    `INSERT INTO billing_webhook_events (stripe_event_id, event_type, livemode, payload_hash)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (stripe_event_id) DO NOTHING
     RETURNING processing_generation`,
    [event.id, event.type, event.livemode, payloadHash],
  );

  if (result.rowCount) return { status: "new", generation: Number(result.rows[0].processing_generation) };

  const existing = await db.query<{
    event_type: string;
    livemode: boolean;
    payload_hash: string;
    processed_at: Date | null;
    processing_error: string | null;
  }>(
    `SELECT event_type, livemode, payload_hash, processed_at, processing_error
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

  if (!persisted.processed_at) {
    const claimed = await db.query<{ processing_generation: string | number }>(
      `UPDATE billing_webhook_events
       SET retry_started_at=now(), processing_generation=processing_generation + 1
       WHERE stripe_event_id=$1
         AND processed_at IS NULL
         AND (
           processing_error IS NOT NULL
           OR created_at < now() - interval '5 minutes'
         )
         AND (retry_started_at IS NULL OR retry_started_at < now() - interval '5 minutes')
       RETURNING processing_generation`,
      [event.id],
    );
    if (claimed.rowCount) return { status: "retry", generation: Number(claimed.rows[0].processing_generation) };
  }

  return { status: "duplicate" };
}

export async function markStripeEventProcessed(eventId: string, generation: number): Promise<boolean> {
  const result = await db.query(
    `UPDATE billing_webhook_events
     SET processed_at=now(), processing_error=NULL, retry_started_at=NULL
     WHERE stripe_event_id=$1 AND processing_generation=$2 AND processed_at IS NULL`,
    [eventId, generation],
  );
  return Boolean(result.rowCount);
}

export async function markStripeEventFailed(eventId: string, generation: number, error: unknown): Promise<boolean> {
  const message = error instanceof Error ? error.message.slice(0, 2000) : "Unknown billing event error";
  const result = await db.query(
    `UPDATE billing_webhook_events
     SET processing_error=$3, retry_started_at=NULL
     WHERE stripe_event_id=$1 AND processing_generation=$2 AND processed_at IS NULL`,
    [eventId, generation, message],
  );
  return Boolean(result.rowCount);
}
