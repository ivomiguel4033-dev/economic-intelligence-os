import { claimOutbox, markOutboxDelivered, markOutboxFailed, reclaimStaleOutbox, type OutboxMessage } from "@/execution/transactional-outbox";
import { incrementMetric } from "@/observability/service-metrics";
import { log } from "@/observability/structured-log";

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
    incrementMetric("outbox_reclaimed_total", recovered.reclaimed);
    incrementMetric("outbox_dead_lettered_total", recovered.deadLettered);
    if (recovered.reclaimed > 0 || recovered.deadLettered > 0) {
      log(recovered.deadLettered > 0 ? "warn" : "info", {
        event: "outbox.recovery.completed",
        metadata: {
          workerId: this.workerId,
          reclaimed: recovered.reclaimed,
          deadLettered: recovered.deadLettered,
        },
      });
    }

    const messages = await claimOutbox(this.workerId, limit);
    incrementMetric("outbox_claimed_total", messages.length);
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
          claimToken: message.claimToken,
        });
        delivered += 1;
        incrementMetric("outbox_delivered_total");
        log("info", {
          event: "outbox.delivery.succeeded",
          organizationId: message.organizationId,
          metadata: {
            messageId: message.id,
            executionRunId: message.executionRunId,
            eventType: message.eventType,
            workerId: this.workerId,
            attempts: message.attempts,
          },
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Outbox delivery failed";
        const outcome = await markOutboxFailed({
          id: message.id,
          organizationId: message.organizationId,
          workerId: this.workerId,
          claimToken: message.claimToken,
          error: reason,
          retryAfterSeconds: this.retryAfterSeconds,
          maxAttempts: this.maxAttempts,
        });
        if (outcome === "dead_lettered") {
          deadLettered += 1;
          incrementMetric("outbox_dead_lettered_total");
        } else {
          failed += 1;
          incrementMetric("outbox_failed_total");
        }
        log(outcome === "dead_lettered" ? "error" : "warn", {
          event: outcome === "dead_lettered" ? "outbox.delivery.dead_lettered" : "outbox.delivery.failed",
          organizationId: message.organizationId,
          metadata: {
            messageId: message.id,
            executionRunId: message.executionRunId,
            eventType: message.eventType,
            workerId: this.workerId,
            attempts: message.attempts,
            outcome,
          },
        });
      }
    }

    return { claimed: messages.length, delivered, failed, reclaimed: recovered.reclaimed, deadLettered };
  }
}
