export interface CheckoutRequest {
  organizationId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface PortalRequest {
  organizationId: string;
  returnUrl: string;
}

function assertHttpsUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Billing redirect URLs must use HTTPS");
  return url.toString();
}

export function validateCheckoutRequest(input: CheckoutRequest): CheckoutRequest {
  if (!input.organizationId.trim()) throw new Error("organizationId is required");
  if (!input.priceId.startsWith("price_")) throw new Error("Invalid Stripe price id");
  return { ...input, successUrl: assertHttpsUrl(input.successUrl), cancelUrl: assertHttpsUrl(input.cancelUrl) };
}

export function validatePortalRequest(input: PortalRequest): PortalRequest {
  if (!input.organizationId.trim()) throw new Error("organizationId is required");
  return { ...input, returnUrl: assertHttpsUrl(input.returnUrl) };
}
