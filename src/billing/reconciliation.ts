export interface LocalSubscriptionSnapshot {
  customerId: string;
  subscriptionId: string;
  status: string;
  priceId: string;
  currentPeriodEnd?: string;
}

export interface RemoteSubscriptionSnapshot extends LocalSubscriptionSnapshot {}

export interface ReconciliationResult {
  consistent: boolean;
  differences: string[];
}

export function reconcileSubscription(local: LocalSubscriptionSnapshot, remote: RemoteSubscriptionSnapshot): ReconciliationResult {
  const differences: string[] = [];
  if (local.customerId !== remote.customerId) differences.push("customerId");
  if (local.subscriptionId !== remote.subscriptionId) differences.push("subscriptionId");
  if (local.status !== remote.status) differences.push("status");
  if (local.priceId !== remote.priceId) differences.push("priceId");
  if ((local.currentPeriodEnd ?? null) !== (remote.currentPeriodEnd ?? null)) differences.push("currentPeriodEnd");
  return { consistent: differences.length === 0, differences };
}
