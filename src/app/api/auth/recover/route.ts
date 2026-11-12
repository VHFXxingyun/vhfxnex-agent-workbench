import { NextRequest, NextResponse } from "next/server";
import database, { type DbUser } from "@/lib/db";
import { publicUser, setSession } from "@/lib/auth";
import { hashPassword } from "@/lib/password.mjs";
import { readJsonObject } from "@/lib/request";
import { createRecoveryCode, hashRecoveryCode, matchesRecoveryCode } from "@/lib/recovery";
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
    const recoveryCode = String(body.recoveryCode || "").trim();
    const newPassword = String(body.newPassword || "");
    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      recoveryCode.length < 32 ||
      recoveryCode.length > 128 ||
      newPassword.length < 8 ||
      newPassword.length > 128
    ) {
      return NextResponse.json({ error: "请检查邮箱、恢复码和新密码格式。" }, { status: 400 });
    }

    const rateLimit = consumeAuthRateLimits([
      {
        key: `recover:email:${email}`,
        limit: AUTH_RATE_LIMITS.recoveryPerEmail,
        windowMs: AUTH_RATE_LIMITS.windowMs,
      },
      {
        key: `recover:address:${clientAddress(request)}`,
        limit: AUTH_RATE_LIMITS.recoveryPerAddress,
        windowMs: AUTH_RATE_LIMITS.windowMs,
      },
    ]);
    if (!rateLimit.allowed) return rateLimitedResponse(rateLimit.retryAfterSeconds);

    const user = database.prepare("SELECT * FROM users WHERE email = ?").get(email) as
      DbUser | undefined;
    const codeMatches = matchesRecoveryCode(recoveryCode, user?.recovery_code_hash);
    if (!user || !codeMatches) {
      return NextResponse.json({ error: "邮箱或恢复码无效。" }, { status: 400 });
    }

    const passwordHash = await hashPassword(newPassword);
    const nextRecoveryCode = createRecoveryCode();
    const updated = database
      .prepare(
        "UPDATE users SET password_hash = ?, recovery_code_hash = ?, session_version = session_version + 1 WHERE id = ? AND recovery_code_hash = ? AND session_version = ?",
      )
      .run(
        passwordHash,
        hashRecoveryCode(nextRecoveryCode),
        user.id,
        user.recovery_code_hash,
        user.session_version,
      );
    if (updated.changes !== 1) {
      return NextResponse.json({ error: "邮箱或恢复码无效。" }, { status: 400 });
    }

    const recoveredUser = database.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as
      DbUser | undefined;
    if (!recoveredUser) return NextResponse.json({ error: "账户不存在。" }, { status: 404 });
    await setSession(recoveredUser);
    return NextResponse.json({ user: publicUser(recoveredUser), recoveryCode: nextRecoveryCode });
  } catch {
    return NextResponse.json({ error: "账户恢复失败，请稍后重试。" }, { status: 500 });
  }
}
