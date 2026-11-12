import { createHmac } from "node:crypto";

export const AI_RATE_LIMITS = Object.freeze({
  perOperationAccount: 12,
  allOperationsAccount: 20,
  perOperationAddress: 60,
  allOperationsAddress: 120,
  windowMs: 15 * 60 * 1000,
});

export function hashRateLimitKey(value, secret) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function createAiRateLimitPolicies(operation, accountId, address) {
  return [
    {
      key: `ai:${operation}:account:${accountId}`,
      limit: AI_RATE_LIMITS.perOperationAccount,
      windowMs: AI_RATE_LIMITS.windowMs,
    },
    {
      key: `ai:account:${accountId}`,
      limit: AI_RATE_LIMITS.allOperationsAccount,
      windowMs: AI_RATE_LIMITS.windowMs,
    },
    {
      key: `ai:${operation}:address:${address}`,
      limit: AI_RATE_LIMITS.perOperationAddress,
      windowMs: AI_RATE_LIMITS.windowMs,
    },
    {
      key: `ai:address:${address}`,
      limit: AI_RATE_LIMITS.allOperationsAddress,
      windowMs: AI_RATE_LIMITS.windowMs,
    },
  ];
}

export function consumeRateLimitPolicies(database, secret, policies, now = Date.now()) {
  const entries = policies.map((policy) => ({
    keyHash: hashRateLimitKey(policy.key, secret),
    limit: policy.limit,
    windowMs: policy.windowMs,
  }));
  const consume = database.transaction(() => {
    const select = database.prepare(
      "SELECT window_started_at, attempts FROM auth_rate_limits WHERE key_hash = ?",
    );
    const states = entries.map((entry) => ({
      ...entry,
      current: select.get(entry.keyHash),
    }));
    const blocked = states.find(
      ({ current, limit, windowMs }) =>
        current && now - current.window_started_at < windowMs && current.attempts >= limit,
    );
    if (blocked?.current) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((blocked.current.window_started_at + blocked.windowMs - now) / 1000),
        ),
      };
    }

    const upsert = database.prepare(`
      INSERT INTO auth_rate_limits (key_hash, window_started_at, attempts)
      VALUES (?, ?, 1)
      ON CONFLICT(key_hash) DO UPDATE SET
        window_started_at = excluded.window_started_at,
        attempts = excluded.attempts
    `);
    const increment = database.prepare(
      "UPDATE auth_rate_limits SET attempts = attempts + 1 WHERE key_hash = ?",
    );
    for (const { keyHash, current, windowMs } of states) {
      if (!current || now - current.window_started_at >= windowMs) {
        upsert.run(keyHash, now);
      } else {
        increment.run(keyHash);
      }
    }
    database
      .prepare("DELETE FROM auth_rate_limits WHERE window_started_at < ?")
      .run(now - 24 * 60 * 60 * 1000);
    return { allowed: true };
  });
  return consume();
}
