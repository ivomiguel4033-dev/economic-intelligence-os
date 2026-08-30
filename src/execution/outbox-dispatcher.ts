import { claimOutbox, markOutboxDelivered, markOutboxFailed, reclaimStaleOutbox, type OutboxMessage } from "@/execution/transactional-outbox";
import { incrementMetric } from "@/observability/service-metrics";
import { log } from "@/observability/structured-log";

export type OutboxHandler = (message: OutboxMessage) => Promise<void>;

export function resolveOutboxWorkerId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = env.OUTBOX_WORKER_ID?.trim();
  return configured || undefined;
}

export function requireOutboxWorkerId(env: NodeJS.ProcessEnv = process.env): string {
  const workerId = resolveOutboxWorkerId(env);
  if (!workerId) throw new Error("OUTBOX_WORKER_ID is required");
  return workerId;
}

export class OutboxDispatcher {
  private readonly workerId: string;

  constructor(
    workerId: string,
    private readonly handler: OutboxHandler,
    private readonly retryAfterSeconds = 30,
    private readonly staleClaimSeconds = 300,
    private readonly maxAttempts = 5,
  ) {
    const normalizedWorkerId = workerId.trim();
    if (!normalizedWorkerId) throw new Error("OutboxDispatcher requires workerId");

    if (process.env.NODE_ENV === "production") requireOutboxWorkerId();
    const configuredWorkerId = resolveOutboxWorkerId();
    if (configuredWorkerId && configuredWorkerId !== normalizedWorkerId) {
      throw new Error("OutboxDispatcher workerId does not match OUTBOX_WORKER_ID");
    }

    this.workerId = normalizedWorkerId;
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
