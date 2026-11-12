import { NextResponse } from "next/server";
import database from "@/lib/db";
import { getUser } from "@/lib/auth";
import { sameOriginError } from "@/lib/request";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  const actor = await getUser();
  if (!actor || actor.role !== "admin")
    return NextResponse.json({ error: "无权管理工作空间" }, { status: 403 });
  const { id } = await context.params;
  const result = database.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
  if (!result.changes) return NextResponse.json({ error: "工作空间不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
