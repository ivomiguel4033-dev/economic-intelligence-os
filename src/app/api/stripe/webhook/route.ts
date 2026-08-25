import { NextRequest, NextResponse } from "next/server";
import { verifyStripeSignature } from "@/billing/webhook-signature";
import { db } from "@/infrastructure/database/postgres";

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Stripe webhook not configured" }, { status: 503 });

  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") ?? "";
  if (!verifyStripeSignature(payload, signature, secret)) {
    return NextResponse.json({ error: "Invalid Stripe signature" }, { status: 400 });
  }

  const event = JSON.parse(payload) as { id: string; type: string; livemode: boolean; data?: { object?: Record<string, unknown> } };
  const expectedLive = process.env.STRIPE_LIVEMODE === "true";
  if (event.livemode !== expectedLive) {
    return NextResponse.json({ error: "Stripe event mode mismatch" }, { status: 400 });
  }

  const inserted = await db.query(
    `INSERT INTO stripe_webhook_events (event_id, event_type, livemode, payload)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [event.id, event.type, event.livemode, payload],
  );

  if (!inserted.rowCount) return NextResponse.json({ received: true, duplicate: true });
  return NextResponse.json({ received: true });
}
