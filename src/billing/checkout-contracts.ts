import type { PlanCode } from "@/billing/entitlements";

export interface CheckoutRequest {
  organizationId: string;
  planCode: PlanCode;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSessionResult {
  provider: "stripe";
  sessionId: string;
  url: string;
}

export interface CustomerPortalRequest {
  organizationId: string;
  returnUrl: string;
}

export interface CustomerPortalResult {
  provider: "stripe";
  url: string;
}

export interface BillingGateway {
  createCheckoutSession(input: CheckoutRequest): Promise<CheckoutSessionResult>;
  createCustomerPortalSession(input: CustomerPortalRequest): Promise<CustomerPortalResult>;
}
