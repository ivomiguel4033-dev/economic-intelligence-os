import { NextRequest, NextResponse } from "next/server";
import { verifyStripeSignature } from "@/billing/webhook-signature";
import { registerStripeEvent, markStripeEventFailed, markStripeEventProcessed } from "@/billing/stripe-event-store";
import { processStripeEvent } from "@/billing/stripe-event-processor";

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Stripe webhook not configured" }, { status: 503 });

  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  if (!verifyStripeSignature(payload, signature, secret)) {
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  const event = JSON.parse(payload) as { id: string; type: string; livemode: boolean; data?: { object?: never } };
  const expectedLive = process.env.STRIPE_LIVEMODE === "true";
  if (event.livemode !== expectedLive) {
    return NextResponse.json({ error: "Stripe event mode mismatch" }, { status: 400 });
  }

  const registration = await registerStripeEvent({ id: event.id, type: event.type, livemode: event.livemode, rawPayload: payload });
  if (registration === "duplicate") return NextResponse.json({ received: true, duplicate: true });

  try {
    await processStripeEvent(event);
    await markStripeEventProcessed(event.id);
    return NextResponse.json({ received: true });
  } catch (error) {
    await markStripeEventFailed(event.id, error);
    return NextResponse.json({ error: "Stripe event processing failed" }, { status: 500 });
  }
}
