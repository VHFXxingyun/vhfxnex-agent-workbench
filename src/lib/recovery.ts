import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function createRecoveryCode() {
  return randomBytes(32).toString("base64url");
}

export function hashRecoveryCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

export function matchesRecoveryCode(code: string, storedHash: string | null | undefined) {
  const candidate = Buffer.from(hashRecoveryCode(code), "hex");
  const stored = storedHash ? Buffer.from(storedHash, "hex") : Buffer.alloc(candidate.length);
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}
