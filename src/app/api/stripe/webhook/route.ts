import { NextRequest, NextResponse } from "next/server";
import { verifyStripeSignature } from "@/billing/webhook-signature";
import { registerStripeEvent, markStripeEventFailed, markStripeEventProcessed } from "@/billing/stripe-event-store";
import { processStripeEvent } from "@/billing/stripe-event-processor";

const MAX_STRIPE_WEBHOOK_BYTES = 1_000_000;
const STRIPE_WEBHOOK_READ_TIMEOUT_MS = 15_000;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

type StripeWebhookEvent = {
  id: string;
  type: string;
  livemode: boolean;
  data?: { object?: never };
};

type PayloadReadResult =
  | { status: "ok"; payload: string }
  | { status: "too_large" }
  | { status: "timeout" };

function parseStripeEvent(payload: string): StripeWebhookEvent | null {
  try {
    const value = JSON.parse(payload) as unknown;
    if (!value || typeof value !== "object") return null;

    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.id !== "string" ||
      candidate.id.length === 0 ||
      candidate.id.length > 255 ||
      typeof candidate.type !== "string" ||
      candidate.type.length === 0 ||
      candidate.type.length > 255 ||
      typeof candidate.livemode !== "boolean"
    ) return null;

    return value as StripeWebhookEvent;
  } catch {
    return null;
  }
}

function declaredPayloadTooLarge(request: NextRequest): boolean {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return false;
  if (!/^\d+$/.test(contentLength)) return true;
  const bytes = Number(contentLength);
  return !Number.isSafeInteger(bytes) || bytes > MAX_STRIPE_WEBHOOK_BYTES;
}

function configuredStripeMode(): boolean | null {
  const value = process.env.STRIPE_LIVEMODE;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>, reason: string): void {
  // Cancellation is best-effort. Some HTTP stream implementations do not settle
  // cancel() until the peer closes, so awaiting it would defeat our response timeout.
  void reader.cancel(reason).catch(() => undefined);
}

async function readBoundedPayload(request: NextRequest): Promise<PayloadReadResult> {
  if (!request.body) return { status: "ok", payload: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const deadline = Date.now() + STRIPE_WEBHOOK_READ_TIMEOUT_MS;

  try {
    while (true) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        cancelReader(reader, "Stripe webhook payload read timed out");
        return { status: "timeout" };
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        reader.read().then((value) => ({ kind: "read" as const, value })),
        new Promise<{ kind: "timeout" }>((resolve) => {
          timer = setTimeout(() => resolve({ kind: "timeout" }), remainingMs);
        }),
      ]).finally(() => {
        if (timer) clearTimeout(timer);
      });

      if (result.kind === "timeout") {
        cancelReader(reader, "Stripe webhook payload read timed out");
        return { status: "timeout" };
      }

      const { done, value } = result.value;
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_STRIPE_WEBHOOK_BYTES) {
        cancelReader(reader, "Stripe webhook payload exceeds limit");
        return { status: "too_large" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { status: "ok", payload: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { status: "ok", payload: "" };
  }
}

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ error: "Stripe webhook not configured" }, 503);

  const expectedLive = configuredStripeMode();
  if (expectedLive === null) {
    return json({ error: "Stripe webhook mode not configured" }, 503);
  }

  if (declaredPayloadTooLarge(request)) {
    return json({ error: "Stripe event payload too large" }, 413);
  }

  const body = await readBoundedPayload(request);
  if (body.status === "too_large") {
    return json({ error: "Stripe event payload too large" }, 413);
  }
  if (body.status === "timeout") {
    return json({ error: "Stripe event payload read timed out" }, 408);
  }

  const payload = body.payload;
  const signature = request.headers.get("stripe-signature") ?? "";
  if (!verifyStripeSignature(payload, signature, secret)) {
    return json({ error: "Invalid Stripe signature" }, 400);
  }

  const event = parseStripeEvent(payload);
  if (!event) {
    return json({ error: "Invalid Stripe event payload" }, 400);
  }

  if (event.livemode !== expectedLive) {
    return json({ error: "Stripe event mode mismatch" }, 400);
  }

  const registration = await registerStripeEvent({ id: event.id, type: event.type, livemode: event.livemode, rawPayload: payload });
  if (registration.status === "duplicate") return json({ received: true, duplicate: true });

  try {
    await processStripeEvent(event);
    const finalized = await markStripeEventProcessed(event.id, registration.generation);
    if (!finalized) return json({ received: true, superseded: true });
    return json({ received: true });
  } catch (error) {
    const recorded = await markStripeEventFailed(event.id, registration.generation, error);
    if (!recorded) return json({ received: true, superseded: true });
    return json({ error: "Stripe event processing failed" }, 500);
  }
}
