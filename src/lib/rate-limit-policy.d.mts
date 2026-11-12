export type RateLimitPolicy = { key: string; limit: number; windowMs: number };
export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export const AI_RATE_LIMITS: Readonly<{
  perOperationAccount: 12;
  allOperationsAccount: 20;
  perOperationAddress: 60;
  allOperationsAddress: 120;
  windowMs: 900000;
}>;

export function hashRateLimitKey(value: string, secret: string): string;
export function createAiRateLimitPolicies(
  operation: "plan" | "execute",
  accountId: string,
  address: string,
): RateLimitPolicy[];
export function consumeRateLimitPolicies(
  database: unknown,
  secret: string,
  policies: RateLimitPolicy[],
  now?: number,
): RateLimitResult;
