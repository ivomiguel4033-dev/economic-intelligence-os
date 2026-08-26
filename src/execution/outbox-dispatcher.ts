import { claimOutbox, markOutboxDelivered, markOutboxFailed, reclaimStaleOutbox, type OutboxMessage } from "@/execution/transactional-outbox";

export type OutboxHandler = (message: OutboxMessage) => Promise<void>;

export class OutboxDispatcher {
  constructor(
    private readonly workerId: string,
    private readonly handler: OutboxHandler,
    private readonly retryAfterSeconds = 30,
    private readonly staleClaimSeconds = 300,
    private readonly maxAttempts = 5,
  ) {
    if (!workerId) throw new Error("OutboxDispatcher requires workerId");
  }

  async dispatchOnce(limit = 25): Promise<{ claimed: number; delivered: number; failed: number; reclaimed: number; deadLettered: number }> {
    const recovered = await reclaimStaleOutbox(this.staleClaimSeconds, this.retryAfterSeconds, this.maxAttempts);
    const messages = await claimOutbox(this.workerId, limit);
    let delivered = 0;
    let failed = 0;
    let deadLettered = recovered.deadLettered;

    for (const message of messages) {
      try {
        // Handlers must treat message.dedupeKey as the external idempotency key.
        // The outbox provides durable at-least-once delivery, not exactly-once I/O.
        await this.handler(message);
        await markOutboxDelivered({
          id: message.id,
          organizationId: message.organizationId,
          workerId: this.workerId,
        });
        delivered += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Outbox delivery failed";
        const outcome = await markOutboxFailed({
          id: message.id,
          organizationId: message.organizationId,
          workerId: this.workerId,
          error: reason,
          retryAfterSeconds: this.retryAfterSeconds,
          maxAttempts: this.maxAttempts,
        });
        if (outcome === "dead_lettered") deadLettered += 1;
        else failed += 1;
      }
    }

    return { claimed: messages.length, delivered, failed, reclaimed: recovered.reclaimed, deadLettered };
  }
}
