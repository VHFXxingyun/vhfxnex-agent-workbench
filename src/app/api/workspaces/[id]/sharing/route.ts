import { createHash, randomBytes, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { readJsonObject, sameOriginError } from "@/lib/request";
import {
  createWorkspaceShareLinkForUser,
  listWorkspaceMembersForUser,
  listWorkspaceShareLinksForUser,
  removeWorkspaceMemberForUser,
  revokeWorkspaceShareLinkForUser,
} from "@/lib/workspace-store";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  const links = listWorkspaceShareLinksForUser(user.id, id);
  const members = listWorkspaceMembersForUser(user.id, id);
  if (!links || !members)
    return NextResponse.json({ error: "只有工作区所有者可以管理共享权限。" }, { status: 403 });
  return NextResponse.json({ links, members }, { headers: { "Cache-Control": "no-store, private" } });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const body = await readJsonObject(request, 10_000);
  if (!body) return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
  const role = body.role === "editor" ? "editor" : body.role === "viewer" ? "viewer" : null;
  const days = body.expiresInDays === 1 || body.expiresInDays === 7 || body.expiresInDays === 30
    ? body.expiresInDays
    : 7;
  if (!role) return NextResponse.json({ error: "请选择编辑或只读权限。" }, { status: 400 });
  const { id: workspaceId } = await context.params;
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60_000).toISOString();
  const created = createWorkspaceShareLinkForUser(user.id, {
    id: randomUUID(),
    workspaceId,
    tokenHash,
    role,
    expiresAt,
  });
  if (created === "limit")
    return NextResponse.json({ error: "当前最多保留 10 条有效邀请链接，请撤销或等待已有链接过期。" }, { status: 409 });
  if (created !== "created")
    return NextResponse.json({ error: "只有工作区所有者可以创建共享邀请。" }, { status: 403 });
  return NextResponse.json({
    inviteUrl: new URL(`/invite/${token}`, request.url).toString(),
    expiresAt,
    role,
  });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const body = await readJsonObject(request, 10_000);
  if (!body) return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
  const { id: workspaceId } = await context.params;
  if (typeof body.memberId === "string") {
    const removed = removeWorkspaceMemberForUser(user.id, workspaceId, body.memberId);
    return removed
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "成员不存在，或无权移除。" }, { status: 404 });
  }
  if (typeof body.linkId === "string") {
    const revoked = revokeWorkspaceShareLinkForUser(user.id, workspaceId, body.linkId);
    return revoked
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "邀请链接不存在，或无权撤销。" }, { status: 404 });
  }
  return NextResponse.json({ error: "请提供成员或邀请链接标识。" }, { status: 400 });
}
