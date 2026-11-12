import { NextRequest, NextResponse } from "next/server";
import database, { type DbUser } from "@/lib/db";
import { getUser, setSession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password.mjs";
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
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const body = await readJsonObject(request);
    if (!body) return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (
      currentPassword.length < 8 ||
      currentPassword.length > 128 ||
      newPassword.length < 8 ||
      newPassword.length > 128
    ) {
      return NextResponse.json({ error: "密码长度需为 8～128 位。" }, { status: 400 });
    }
    if (currentPassword === newPassword) {
      return NextResponse.json({ error: "新密码需要与当前密码不同。" }, { status: 400 });
    }
    const rateLimit = consumeAuthRateLimits([
      {
        key: `password:user:${user.id}`,
        limit: AUTH_RATE_LIMITS.sensitiveActionPerAccount,
        windowMs: AUTH_RATE_LIMITS.windowMs,
      },
      {
        key: `password:address:${clientAddress(request)}`,
        limit: AUTH_RATE_LIMITS.sensitiveActionPerAddress,
        windowMs: AUTH_RATE_LIMITS.windowMs,
      },
    ]);
    if (!rateLimit.allowed) return rateLimitedResponse(rateLimit.retryAfterSeconds);
    if (!(await verifyPassword(currentPassword, user.password_hash))) {
      return NextResponse.json({ error: "当前密码不正确。" }, { status: 403 });
    }

    const passwordHash = await hashPassword(newPassword);
    const updated = database
      .prepare(
        "UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ? AND session_version = ?",
      )
      .run(passwordHash, user.id, user.session_version);
    if (updated.changes !== 1) {
      return NextResponse.json({ error: "登录状态已变化，请重新登录后重试。" }, { status: 409 });
    }

    const renewedUser = database.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as
      DbUser | undefined;
    if (!renewedUser) return NextResponse.json({ error: "账户不存在。" }, { status: 404 });
    await setSession(renewedUser);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "密码更新失败，请稍后重试。" }, { status: 500 });
  }
}
