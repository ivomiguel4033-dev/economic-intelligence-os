import { claimOutbox, markOutboxDelivered, markOutboxFailed, reclaimStaleOutbox, renewOutboxClaim, OutboxClaimOwnershipError, type OutboxMessage } from "@/execution/transactional-outbox";
import { incrementMetric } from "@/observability/service-metrics";
import { log } from "@/observability/structured-log";

export type OutboxHandler = (message: OutboxMessage) => Promise<void>;

class OutboxClaimLostError extends Error {}

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

  private claimHeartbeatMs(): number {
    const staleSeconds = Number.isFinite(this.staleClaimSeconds)
      ? Math.max(30, Math.min(Math.trunc(this.staleClaimSeconds), 86400))
      : 300;
    return Math.floor((staleSeconds * 1000) / 3);
  }

  private recordClaimLost(message: OutboxMessage): void {
    incrementMetric("outbox_claim_lost_total");
    log("error", {
      event: "outbox.claim.lost",
      organizationId: message.organizationId,
      metadata: {
        messageId: message.id,
        executionRunId: message.executionRunId,
        eventType: message.eventType,
        workerId: this.workerId,
        attempts: message.attempts,
      },
    });
  }

  private async runHandlerWithClaimHeartbeat(message: OutboxMessage): Promise<void> {
    let claimLost = false;
    let heartbeatInFlight: Promise<void> | undefined;

    const heartbeat = setInterval(() => {
      if (heartbeatInFlight || claimLost) return;
      heartbeatInFlight = renewOutboxClaim({
        id: message.id,
        organizationId: message.organizationId,
        workerId: this.workerId,
        claimToken: message.claimToken,
      }).then((renewed) => {
        if (!renewed) claimLost = true;
      }).catch((error) => {
        // If the heartbeat cannot prove ownership, fail closed. The handler may
        // already be in-flight, but we must not acknowledge the message after
        // an indeterminate renewal because another worker may legitimately
        // reclaim it once the durable claim expires.
        claimLost = true;
        log("warn", {
          event: "outbox.claim.heartbeat_failed",
          organizationId: message.organizationId,
          metadata: {
            messageId: message.id,
            workerId: this.workerId,
            error: error instanceof Error ? error.message : "Outbox claim heartbeat failed",
          },
        });
      }).finally(() => {
        heartbeatInFlight = undefined;
      });
    }, this.claimHeartbeatMs());
    heartbeat.unref?.();

    let handlerError: unknown;
    try {
      await this.handler(message);
    } catch (error) {
      handlerError = error;
    } finally {
      clearInterval(heartbeat);
      if (heartbeatInFlight) await heartbeatInFlight;
    }

    if (claimLost) throw new OutboxClaimLostError("Outbox claim lost during delivery");
    if (handlerError !== undefined) throw handlerError;
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
        await this.runHandlerWithClaimHeartbeat(message);
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
        if (error instanceof OutboxClaimLostError || error instanceof OutboxClaimOwnershipError) {
          this.recordClaimLost(message);
          throw error;
        }

        const reason = error instanceof Error ? error.message : "Outbox delivery failed";
        let outcome: "failed" | "dead_lettered";
        try {
          outcome = await markOutboxFailed({
            id: message.id,
            organizationId: message.organizationId,
            workerId: this.workerId,
            claimToken: message.claimToken,
            error: reason,
            retryAfterSeconds: this.retryAfterSeconds,
            maxAttempts: this.maxAttempts,
          });
        } catch (ackError) {
          if (ackError instanceof OutboxClaimOwnershipError) {
            this.recordClaimLost(message);
          }
          throw ackError;
        }
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
