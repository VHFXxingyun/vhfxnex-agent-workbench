import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import database, { type DbUser } from "@/lib/db";
import { isSessionSecretValid } from "@/lib/session-secret.mjs";

const cookieName = "goalflow_session";
const secret =
  process.env.SESSION_SECRET ||
  (process.env.NODE_ENV === "development"
    ? "dev-only-goalflow-session-secret-change-for-production"
    : "");

export function isSessionConfigured() {
  return isSessionSecretValid(secret);
}

export type PublicUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  createdAt: string;
  recoveryCodeConfigured: boolean;
};
export function publicUser(user: DbUser): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.created_at,
    recoveryCodeConfigured: Boolean(user.recovery_code_hash),
  };
}

export async function setSession(user: DbUser) {
  if (!isSessionConfigured()) throw new Error("请配置至少 32 字节的 SESSION_SECRET");
  const token = await new SignJWT({ role: user.role, ver: user.session_version })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(secret));
  (await cookies()).set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName)?.value;
  if (isSessionConfigured() && token) {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
      if (payload.sub) {
        const tokenVersion = typeof payload.ver === "number" ? payload.ver : 0;
        database
          .prepare(
            "UPDATE users SET session_version = session_version + 1 WHERE id = ? AND session_version = ?",
          )
          .run(payload.sub, tokenVersion);
      }
    } catch {
      // Clear malformed, expired, or already-revoked cookies as well.
    }
  }
  cookieStore.delete(cookieName);
}

export async function getUser(): Promise<DbUser | null> {
  if (!isSessionConfigured()) return null;
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    if (!payload.sub) return null;
    const user = database.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub) as
      DbUser | undefined;
    if (!user) return null;
    const tokenVersion = payload.ver;
    if (
      (tokenVersion === undefined && user.session_version !== 0) ||
      (tokenVersion !== undefined &&
        (typeof tokenVersion !== "number" || tokenVersion !== user.session_version))
    ) {
      return null;
    }
    return user;
  } catch {
    return null;
  }
}
