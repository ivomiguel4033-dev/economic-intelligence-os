import { resolveOutboxWorkerId } from "./execution/outbox-dispatcher";
import { log } from "./observability/structured-log";
import { waitForWorkerDrainSafety } from "./operations/deployment-safety";
import { beginDrain } from "./operations/drain-state";

const SIGNAL_HANDLERS_INSTALLED = Symbol.for(
  "economic-intelligence-os.shutdown-signal-handlers-installed",
);
const SHUTDOWN_COORDINATION_STARTED = Symbol.for(
  "economic-intelligence-os.shutdown-coordination-started",
);

type ProcessWithShutdownMarker = NodeJS.Process & {
  [SIGNAL_HANDLERS_INSTALLED]?: boolean;
  [SHUTDOWN_COORDINATION_STARTED]?: boolean;
};

/**
 * Next.js invokes register once per server instance. Mark the process as
 * draining as soon as the platform asks it to terminate, while leaving
 * Next.js' own signal handlers responsible for closing the HTTP server.
 *
 * Drain coordination is deliberately idempotent: repeated SIGTERM/SIGINT
 * signals never start competing safety loops. A worker identity is required
 * before durable outbox claims can be inspected; without one we fail closed
 * operationally and never emit a false safe-to-terminate result.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const currentProcess = process as ProcessWithShutdownMarker;
  if (currentProcess[SIGNAL_HANDLERS_INSTALLED]) return;

  currentProcess[SIGNAL_HANDLERS_INSTALLED] = true;

  const enterDrain = (signal: NodeJS.Signals): void => {
    beginDrain();

    if (currentProcess[SHUTDOWN_COORDINATION_STARTED]) return;
    currentProcess[SHUTDOWN_COORDINATION_STARTED] = true;

    const workerId = resolveOutboxWorkerId();
    if (!workerId) {
      log("error", {
        event: "shutdown.drain.uncoordinated",
        metadata: {
          signal,
          reason: "OUTBOX_WORKER_ID is not configured",
        },
      });
      return;
    }

    log("info", {
      event: "shutdown.drain.started",
      metadata: { signal, workerId },
    });

    void waitForWorkerDrainSafety(workerId)
      .then((result) => {
        const level = result.safeToTerminate ? "info" : "warn";
        log(level, {
          event: result.safeToTerminate ? "shutdown.drain.safe" : "shutdown.drain.timeout",
          durationMs: result.elapsedMs,
          metadata: {
            signal,
            workerId,
            timedOut: result.timedOut,
            blockers: result.blockers,
          },
        });
      })
      .catch((error: unknown) => {
        log("error", {
          event: "shutdown.drain.failed",
          metadata: {
            signal,
            workerId,
            reason: error instanceof Error ? error.message : "Unknown drain coordination failure",
          },
        });
      });
  };

  process.on("SIGTERM", () => enterDrain("SIGTERM"));
  process.on("SIGINT", () => enterDrain("SIGINT"));
}
