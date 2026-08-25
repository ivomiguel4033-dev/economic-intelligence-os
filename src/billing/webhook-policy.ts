export const SUPPORTED_STRIPE_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

export function assertSupportedStripeEvent(type: string): void {
  if (!SUPPORTED_STRIPE_EVENTS.has(type)) {
    throw new Error(`Unsupported Stripe event: ${type}`);
  }
}

export function assertBillingMode(livemode: boolean): void {
  const expectedLiveMode = process.env.STRIPE_LIVE_MODE === "true";
  if (livemode !== expectedLiveMode) {
    throw new Error("Stripe event mode does not match application billing mode");
  }
}
