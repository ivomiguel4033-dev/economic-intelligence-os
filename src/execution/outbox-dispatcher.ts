import { claimOutbox, markOutboxDelivered, markOutboxFailed, type OutboxMessage } from "@/execution/transactional-outbox";

export type OutboxHandler = (message: OutboxMessage) => Promise<void>;

export class OutboxDispatcher {
  constructor(
    private readonly workerId: string,
    private readonly handler: OutboxHandler,
    private readonly retryAfterSeconds = 30,
  ) {
    if (!workerId) throw new Error("OutboxDispatcher requires workerId");
  }

  async dispatchOnce(limit = 25): Promise<{ claimed: number; delivered: number; failed: number }> {
    const messages = await claimOutbox(this.workerId, limit);
    let delivered = 0;
    let failed = 0;

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
        failed += 1;
        const reason = error instanceof Error ? error.message : "Outbox delivery failed";
        await markOutboxFailed({
          id: message.id,
          organizationId: message.organizationId,
          workerId: this.workerId,
          error: reason,
          retryAfterSeconds: this.retryAfterSeconds,
        });
      }
    }

    return { claimed: messages.length, delivered, failed };
  }
}
