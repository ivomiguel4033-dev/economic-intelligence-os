import { NextRequest, NextResponse } from "next/server";
import { verifyStripeSignature } from "@/billing/webhook-signature";
import { registerStripeEvent, markStripeEventFailed, markStripeEventProcessed } from "@/billing/stripe-event-store";
import { processStripeEvent } from "@/billing/stripe-event-processor";

const MAX_STRIPE_WEBHOOK_BYTES = 1_000_000;

type StripeWebhookEvent = {
  id: string;
  type: string;
  livemode: boolean;
  data?: { object?: never };
};

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

async function readBoundedPayload(request: NextRequest): Promise<string | null> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_STRIPE_WEBHOOK_BYTES) {
        await reader.cancel("Stripe webhook payload exceeds limit");
        return null;
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
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "";
  }
}

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Stripe webhook not configured" }, { status: 503 });

  if (declaredPayloadTooLarge(request)) {
    return NextResponse.json({ error: "Stripe event payload too large" }, { status: 413 });
  }

  const payload = await readBoundedPayload(request);
  if (payload === null) {
    return NextResponse.json({ error: "Stripe event payload too large" }, { status: 413 });
  }

  const signature = request.headers.get("stripe-signature") ?? "";
  if (!verifyStripeSignature(payload, signature, secret)) {
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  const event = parseStripeEvent(payload);
  if (!event) {
    return NextResponse.json({ error: "Invalid Stripe event payload" }, { status: 400 });
  }

  const expectedLive = process.env.STRIPE_LIVEMODE === "true";
  if (event.livemode !== expectedLive) {
    return NextResponse.json({ error: "Stripe event mode mismatch" }, { status: 400 });
  }

  const registration = await registerStripeEvent({ id: event.id, type: event.type, livemode: event.livemode, rawPayload: payload });
  if (registration.status === "duplicate") return NextResponse.json({ received: true, duplicate: true });

  try {
    await processStripeEvent(event);
    const finalized = await markStripeEventProcessed(event.id, registration.generation);
    if (!finalized) return NextResponse.json({ received: true, superseded: true });
    return NextResponse.json({ received: true });
  } catch (error) {
    const recorded = await markStripeEventFailed(event.id, registration.generation, error);
    if (!recorded) return NextResponse.json({ received: true, superseded: true });
    return NextResponse.json({ error: "Stripe event processing failed" }, { status: 500 });
  }
}
