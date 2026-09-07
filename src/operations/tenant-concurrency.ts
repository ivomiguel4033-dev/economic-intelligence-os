type TenantConcurrencyState = {
  active: number;
};

const tenantConcurrency = new Map<string, TenantConcurrencyState>();
const DEFAULT_MAX_CONCURRENCY_PER_TENANT = 2;

function configuredLimit(): number {
  const raw = process.env.ORCHESTRATION_MAX_CONCURRENCY_PER_TENANT;
  if (!raw) return DEFAULT_MAX_CONCURRENCY_PER_TENANT;

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_CONCURRENCY_PER_TENANT;
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
