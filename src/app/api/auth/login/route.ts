import { NextRequest, NextResponse } from "next/server";
import database, { type DbUser } from "@/lib/db";
import { isSessionConfigured, publicUser, setSession } from "@/lib/auth";
import { hashPassword, needsPasswordUpgrade, verifyPassword } from "@/lib/password.mjs";
import { readJsonObject } from "@/lib/request";
import {
  AUTH_RATE_LIMITS,
  clientAddress,
  consumeAuthRateLimits,
  rateLimitedResponse,
} from "@/lib/auth-rate-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObject(request);
    if (!body) return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
    const email = String(body.email || "")
      .trim()
      .toLowerCase();
    const password = String(body.password || "");
    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < 8 ||
      password.length > 128
    ) {
      return NextResponse.json({ error: "请输入有效邮箱和 8～128 位密码。" }, { status: 400 });
    }
    if (!isSessionConfigured()) {
      return NextResponse.json(
        { error: "服务尚未配置登录会话密钥，请联系管理员。" },
        { status: 503 },
      );
    }
    const rateLimit = consumeAuthRateLimits([
      {
        key: `login:email:${email}`,
        limit: AUTH_RATE_LIMITS.sensitiveActionPerAccount,
        windowMs: AUTH_RATE_LIMITS.windowMs,
      },
      {
        key: `login:address:${clientAddress(request)}`,
        limit: AUTH_RATE_LIMITS.sensitiveActionPerAddress,
        windowMs: AUTH_RATE_LIMITS.windowMs,
      },
    ]);
    if (!rateLimit.allowed) return rateLimitedResponse(rateLimit.retryAfterSeconds);
    const user = database.prepare("SELECT * FROM users WHERE email = ?").get(email) as
      DbUser | undefined;
    const passwordMatches = await verifyPassword(
      password,
      user?.password_hash || "$2b$12$1euFv.gyKBBkRutpO6YbYOAvIfSw5GSF3jXrNA0aOR8LexMEpso0O",
    );
    if (!user || !passwordMatches) {
      return NextResponse.json({ error: "邮箱或密码不正确。" }, { status: 401 });
    }
    if (needsPasswordUpgrade(user.password_hash)) {
      const upgradedHash = await hashPassword(password);
      database
        .prepare("UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?")
        .run(upgradedHash, user.id, user.password_hash);
    }
    await setSession(user);
    return NextResponse.json({ user: publicUser(user) });
  } catch {
    return NextResponse.json({ error: "登录失败，请稍后再试。" }, { status: 500 });
  }
}
