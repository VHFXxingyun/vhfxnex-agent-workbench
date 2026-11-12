import { NextResponse } from "next/server";
import database from "@/lib/db";
import { getUser } from "@/lib/auth";
import { sameOriginError } from "@/lib/request";
import { getWorkspaceForUser } from "@/lib/workspace-store";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  const workspace = getWorkspaceForUser(user.id, id);
  if (!workspace) return NextResponse.json({ error: "工作空间不存在" }, { status: 404 });
  return NextResponse.json({ workspace }, { headers: { "Cache-Control": "no-store, private" } });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const { id } = await context.params;
  const result = database
    .prepare("DELETE FROM workspaces WHERE id = ? AND user_id = ?")
    .run(id, user.id);

  if (!result.changes) return NextResponse.json({ error: "工作空间不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
