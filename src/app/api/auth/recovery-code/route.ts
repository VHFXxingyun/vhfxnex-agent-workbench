import { NextRequest, NextResponse } from "next/server";
import database from "@/lib/db";
import { getUser } from "@/lib/auth";
import { verifyPassword } from "@/lib/password.mjs";
import { readJsonObject } from "@/lib/request";
import { createRecoveryCode, hashRecoveryCode } from "@/lib/recovery";
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
    if (currentPassword.length < 8 || currentPassword.length > 128) {
      return NextResponse.json({ error: "请输入有效的当前密码。" }, { status: 400 });
    }
    const rateLimit = consumeAuthRateLimits([
      {
        key: `recovery-code:user:${user.id}`,
        limit: AUTH_RATE_LIMITS.sensitiveActionPerAccount,
        windowMs: AUTH_RATE_LIMITS.windowMs,
      },
      {
        key: `recovery-code:address:${clientAddress(request)}`,
        limit: AUTH_RATE_LIMITS.sensitiveActionPerAddress,
        windowMs: AUTH_RATE_LIMITS.windowMs,
      },
    ]);
    if (!rateLimit.allowed) return rateLimitedResponse(rateLimit.retryAfterSeconds);
    if (!(await verifyPassword(currentPassword, user.password_hash))) {
      return NextResponse.json({ error: "当前密码不正确。" }, { status: 403 });
    }

    const recoveryCode = createRecoveryCode();
    const updated = database
      .prepare("UPDATE users SET recovery_code_hash = ? WHERE id = ? AND session_version = ?")
      .run(hashRecoveryCode(recoveryCode), user.id, user.session_version);
    if (updated.changes !== 1) {
      return NextResponse.json({ error: "登录状态已变化，请重新登录后重试。" }, { status: 409 });
    }
    return NextResponse.json({ recoveryCode });
  } catch {
    return NextResponse.json({ error: "恢复码生成失败，请稍后重试。" }, { status: 500 });
  }
}
