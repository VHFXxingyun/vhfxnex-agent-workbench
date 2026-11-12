import "server-only";
import { NextResponse } from "next/server";
import database from "@/lib/db";
import { configuredTrustedProxyHops, resolveClientAddress } from "@/lib/client-address.mjs";
import {
  AI_RATE_LIMITS,
  consumeRateLimitPolicies,
  createAiRateLimitPolicies,
  type RateLimitPolicy,
  type RateLimitResult,
} from "@/lib/rate-limit-policy.mjs";

export { AI_RATE_LIMITS };
export type { RateLimitPolicy, RateLimitResult };

const hashSecret =
  process.env.SESSION_SECRET?.trim() || "local-goalflow-rate-limit-secret-change-for-production";
const windowDurationMs = 15 * 60 * 1000;

export function clientAddress(request: Request) {
  return resolveClientAddress(request.headers, configuredTrustedProxyHops(process.env));
}

export function consumeRateLimits(policies: RateLimitPolicy[]): RateLimitResult {
  return consumeRateLimitPolicies(database, hashSecret, policies);
}

export const consumeAuthRateLimits = consumeRateLimits;

export function rateLimitedResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: `尝试次数过多，请在 ${retryAfterSeconds} 秒后重试。` },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

export const AUTH_RATE_LIMITS = {
  sensitiveActionPerAccount: 8,
  sensitiveActionPerAddress: 180,
  recoveryPerEmail: 5,
  recoveryPerAddress: 45,
  registrationPerAddress: 60,
  windowMs: windowDurationMs,
  registrationWindowMs: 60 * 60 * 1000,
} as const;

export function consumeAiRateLimits(
  operation: "plan" | "execute",
  accountId: string,
  request: Request,
) {
  return consumeRateLimits(createAiRateLimitPolicies(operation, accountId, clientAddress(request)));
}
