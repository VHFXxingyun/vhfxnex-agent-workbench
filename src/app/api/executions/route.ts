import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { readJsonObject } from "@/lib/request";
import {
  listWorkspaceExecutionStatusesForUser,
  requestWorkspaceExecutionCancellationForUser,
} from "@/lib/workspace-store";

export const runtime = "nodejs";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  return NextResponse.json(
    { executions: listWorkspaceExecutionStatusesForUser(user.id) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const body = await readJsonObject(request, 20_000);
  if (!body) return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId))
    return NextResponse.json({ error: "工作区标识无效。" }, { status: 400 });
  const cancelled = requestWorkspaceExecutionCancellationForUser(user.id, workspaceId);
  return NextResponse.json({ cancelled });
}
