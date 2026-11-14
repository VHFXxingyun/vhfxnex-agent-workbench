import { createHmac } from "node:crypto";

const DEVELOPMENT_SESSION_SECRET = "dev-only-goalflow-session-secret-change-for-production";

/** Return a stable, pseudonymous DeepSeek user ID for provider-side cache isolation. */
export function getDeepSeekUserId(userId, secret = process.env.SESSION_SECRET) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new TypeError("A non-empty application user ID is required for DeepSeek isolation.");
  }

  const key =
    typeof secret === "string" && secret.length > 0
      ? secret
      : process.env.NODE_ENV === "production"
        ? null
        : DEVELOPMENT_SESSION_SECRET;
  if (!key)
    throw new Error("SESSION_SECRET is required for DeepSeek user isolation in production.");
  const digest = createHmac("sha256", key)
    .update("vhfxnex:deepseek:kv-cache:v1\0")
    .update(userId)
    .digest("hex");
  return `vhfxnex_${digest}`;
}
