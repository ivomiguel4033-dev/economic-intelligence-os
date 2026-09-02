type TenantConcurrencyState = {
  active: number;
};

const tenantConcurrency = new Map<string, TenantConcurrencyState>();

function configuredLimit(): number {
  const parsed = Number.parseInt(process.env.ORCHESTRATION_MAX_CONCURRENCY_PER_TENANT ?? "2", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
}

export function tryAcquireTenantConcurrency(organizationId: string): (() => void) | null {
  const current = tenantConcurrency.get(organizationId)?.active ?? 0;
  if (current >= configuredLimit()) return null;

  tenantConcurrency.set(organizationId, { active: current + 1 });
  let released = false;

  return () => {
    if (released) return;
    released = true;
    const active = tenantConcurrency.get(organizationId)?.active ?? 0;
    if (active <= 1) tenantConcurrency.delete(organizationId);
    else tenantConcurrency.set(organizationId, { active: active - 1 });
  };
}
