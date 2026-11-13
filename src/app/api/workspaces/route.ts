import { NextRequest, NextResponse } from "next/server";
import database, { type DbWorkspace } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { readJsonObject } from "@/lib/request";
import { isWorkspace } from "@/lib/workspace-validation";
import { accountDataLimits } from "@/lib/limits";
import { saveWorkspaceForUser } from "@/lib/workspace-store";

export const runtime = "nodejs";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const rows = database
    .prepare(
      `SELECT w.*, CASE WHEN w.user_id = ? THEN 'owner' ELSE m.role END AS access_role
         FROM workspaces w LEFT JOIN workspace_members m
           ON m.workspace_id = w.id AND m.user_id = ?
        WHERE w.user_id = ? OR m.user_id = ?
        ORDER BY w.updated_at DESC LIMIT ?`,
    )
    .all(user.id, user.id, user.id, user.id, accountDataLimits.workspaces) as (DbWorkspace & {
    access_role: "owner" | "editor" | "viewer";
  })[];
  const workspaces = rows.flatMap((row) => {
    try {
      const workspace: unknown = JSON.parse(row.body);
      return isWorkspace(workspace) ? [workspace] : [];
    } catch {
      return [];
    }
  });
  return NextResponse.json({
    workspaces,
    accessByWorkspaceId: Object.fromEntries(rows.map((row) => [row.id, row.access_role])),
  });
}

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const body = await readJsonObject(request, 400_000);
  if (!body) return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
  const outcome = saveWorkspaceForUser(user.id, body.workspace);
  if (outcome === "forbidden")
    return NextResponse.json({ error: "你只有查看权限，无法修改这个工作区。" }, { status: 403 });
  if (outcome === "locked")
    return NextResponse.json(
      { error: "这个目标正在由 Agent 执行，执行完成后再编辑或保存。" },
      { status: 409 },
    );
  if (outcome === "invalid")
    return NextResponse.json({ error: "工作空间数据无效" }, { status: 400 });
  if (outcome === "too-large") {
    return NextResponse.json(
      { error: "工作空间内容超过 250 KB 上限，请精简内容后重试。" },
      { status: 400 },
    );
  }
  if (outcome === "conflict") {
    return NextResponse.json({ error: "工作空间 ID 冲突，请重新创建。" }, { status: 409 });
  }
  if (outcome === "limit") {
    return NextResponse.json(
      { error: `工作空间最多保存 ${accountDataLimits.workspaces} 个，请先删除不需要的目标。` },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, id: (body.workspace as { id: string }).id });
}
