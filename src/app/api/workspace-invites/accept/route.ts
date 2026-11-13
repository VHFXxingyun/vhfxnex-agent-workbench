import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { readJsonObject, sameOriginError } from "@/lib/request";
import { acceptWorkspaceShareLinkForUser } from "@/lib/workspace-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请登录后再接受工作区邀请。" }, { status: 401 });
  const body = await readJsonObject(request, 10_000);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token || token.length > 160)
    return NextResponse.json({ error: "邀请链接格式无效。" }, { status: 400 });
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const result = acceptWorkspaceShareLinkForUser(user.id, tokenHash);
  if (result.status !== "accepted") {
    const status = result.status === "missing" ? 404 : 410;
    const message = {
      missing: "邀请链接无效或已撤销。",
      expired: "邀请链接已过期，请联系所有者重新生成。",
      revoked: "邀请链接已被所有者撤销。",
      exhausted: "邀请链接已达到加入人数上限。",
    }[result.status];
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json(result);
}
