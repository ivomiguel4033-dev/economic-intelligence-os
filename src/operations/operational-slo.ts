export type OutboxOperationalSnapshot = {
  ready: number;
  processing: number;
  failed: number;
  deadLettered: number;
  oldestReadyAgeSeconds: number;
};

export type OutboxSloThresholds = {
  readyBacklog: number;
  failedMessages: number;
  oldestReadyAgeSeconds: number;
};

export type OutboxSloEvaluation = {
  backlogBreached: boolean;
  failedBreached: boolean;
  deadLetterBreached: boolean;
  oldestReadyAgeBreached: boolean;
};

const DEFAULT_THRESHOLDS: OutboxSloThresholds = {
  readyBacklog: 100,
  failedMessages: 10,
  oldestReadyAgeSeconds: 300,
};

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function getOutboxSloThresholds(): OutboxSloThresholds {
  return {
    readyBacklog: positiveInteger(
      process.env.OUTBOX_SLO_READY_BACKLOG,
      DEFAULT_THRESHOLDS.readyBacklog,
    ),
    failedMessages: positiveInteger(
      process.env.OUTBOX_SLO_FAILED_MESSAGES,
      DEFAULT_THRESHOLDS.failedMessages,
    ),
    oldestReadyAgeSeconds: positiveInteger(
      process.env.OUTBOX_SLO_OLDEST_READY_AGE_SECONDS,
      DEFAULT_THRESHOLDS.oldestReadyAgeSeconds,
    ),
  };
}

export function evaluateOutboxSlo(
  snapshot: OutboxOperationalSnapshot,
  thresholds: OutboxSloThresholds = getOutboxSloThresholds(),
): OutboxSloEvaluation {
  return {
    backlogBreached: snapshot.ready >= thresholds.readyBacklog,
    failedBreached: snapshot.failed >= thresholds.failedMessages,
    deadLetterBreached: snapshot.deadLettered > 0,
    oldestReadyAgeBreached:
      snapshot.oldestReadyAgeSeconds >= thresholds.oldestReadyAgeSeconds,
  };
}
