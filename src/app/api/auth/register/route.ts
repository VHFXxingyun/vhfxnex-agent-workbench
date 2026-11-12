import { NextRequest, NextResponse } from "next/server";
import database, { type DbUser } from "@/lib/db";
import { isSessionConfigured, publicUser, setSession } from "@/lib/auth";
import { hashPassword } from "@/lib/password.mjs";
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
    const body = await readJsonObject(request);
    if (!body) return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (
      name.length < 2 ||
      name.length > 48 ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      password.length < 8 ||
      password.length > 128
    ) {
      return NextResponse.json(
        { error: "请填写姓名、有效邮箱及 8～128 位密码。" },
        { status: 400 },
      );
    }
    if (!isSessionConfigured()) {
      return NextResponse.json(
        { error: "服务尚未配置登录会话密钥，请联系管理员。" },
        { status: 503 },
      );
    }
    const rateLimit = consumeAuthRateLimits([
      {
        key: `register:address:${clientAddress(request)}`,
        limit: AUTH_RATE_LIMITS.registrationPerAddress,
        windowMs: AUTH_RATE_LIMITS.registrationWindowMs,
      },
    ]);
    if (!rateLimit.allowed) return rateLimitedResponse(rateLimit.retryAfterSeconds);
    const user: DbUser = {
      id: crypto.randomUUID(),
      name,
      email,
      password_hash: await hashPassword(password),
      recovery_code_hash: null,
      role: "member",
      session_version: 0,
      created_at: new Date().toISOString(),
    };
    const recoveryCode = createRecoveryCode();
    user.recovery_code_hash = hashRecoveryCode(recoveryCode);
    const createUser = database.transaction(() => {
      const firstUser =
        (database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number })
          .count === 0;
      user.role = process.env.ADMIN_EMAIL
        ? email === process.env.ADMIN_EMAIL.trim().toLowerCase()
          ? "admin"
          : "member"
        : process.env.NODE_ENV === "development" && firstUser
          ? "admin"
          : "member";
      return database
        .prepare(
          "INSERT OR IGNORE INTO users (id, name, email, password_hash, recovery_code_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          user.id,
          user.name,
          user.email,
          user.password_hash,
          user.recovery_code_hash,
          user.role,
          user.created_at,
        ).changes;
    });
    if (createUser() !== 1) {
      return NextResponse.json({ error: "这个邮箱已经注册。" }, { status: 409 });
    }
    await setSession(user);
    return NextResponse.json({ user: publicUser(user), recoveryCode });
  } catch {
    return NextResponse.json({ error: "注册失败，请稍后再试。" }, { status: 500 });
  }
}
