export interface RateLimitRule {
  key: string;
  windowSeconds: number;
  maxRequests: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export function evaluateRateLimit(count: number, rule: RateLimitRule, elapsedSeconds: number): RateLimitDecision {
  if (elapsedSeconds >= rule.windowSeconds) return { allowed: true };
  if (count < rule.maxRequests) return { allowed: true };
  return { allowed: false, retryAfterSeconds: Math.max(1, rule.windowSeconds - Math.max(0, Math.floor(elapsedSeconds))) };
}

export const AUTH_RATE_LIMITS = {
  login: { key: "auth:login", windowSeconds: 60, maxRequests: 10 },
  stepUp: { key: "auth:step-up", windowSeconds: 300, maxRequests: 5 },
  orchestration: { key: "api:orchestration", windowSeconds: 60, maxRequests: 30 },
} satisfies Record<string, RateLimitRule>;
