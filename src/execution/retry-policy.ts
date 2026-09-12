export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_EXTERNAL_RETRY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 2_000,
};

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid retry policy ${field}`);
  }
}

function assertRetryPolicy(policy: RetryPolicy): void {
  assertPositiveSafeInteger(policy.maxAttempts, "maxAttempts");
  assertPositiveSafeInteger(policy.baseDelayMs, "baseDelayMs");
  assertPositiveSafeInteger(policy.maxDelayMs, "maxDelayMs");
  if (policy.baseDelayMs > policy.maxDelayMs) {
    throw new Error("Invalid retry policy delay range");
  }
}

export function retryDelay(attempt: number, policy = DEFAULT_EXTERNAL_RETRY): number {
  assertPositiveSafeInteger(attempt, "attempt");
  assertRetryPolicy(policy);

  const exponent = attempt - 1;
  const ratio = policy.maxDelayMs / policy.baseDelayMs;
  const cappedExponent = Math.min(exponent, Math.max(0, Math.ceil(Math.log2(ratio))));
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** cappedExponent);
}

export function isRetryableStatus(status: number): boolean {
  if (!Number.isInteger(status) || status < 100 || status > 599) return false;
  return status === 408 || status === 429 || status >= 500;
}
