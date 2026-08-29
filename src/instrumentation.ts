import { beginDrain } from "./operations/drain-state";

const SIGNAL_HANDLERS_INSTALLED = Symbol.for(
  "economic-intelligence-os.shutdown-signal-handlers-installed",
);

type ProcessWithShutdownMarker = NodeJS.Process & {
  [SIGNAL_HANDLERS_INSTALLED]?: boolean;
};

/**
 * Next.js invokes register once per server instance. Mark the process as
 * draining as soon as the platform asks it to terminate, while leaving
 * Next.js' own signal handlers responsible for closing the HTTP server.
 *
 * The process-global marker makes this idempotent under development reloads
 * and avoids accumulating duplicate signal listeners.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const currentProcess = process as ProcessWithShutdownMarker;
  if (currentProcess[SIGNAL_HANDLERS_INSTALLED]) return;

  currentProcess[SIGNAL_HANDLERS_INSTALLED] = true;

  const enterDrain = (): void => {
    beginDrain();
  };

  process.on("SIGTERM", enterDrain);
  process.on("SIGINT", enterDrain);
}
