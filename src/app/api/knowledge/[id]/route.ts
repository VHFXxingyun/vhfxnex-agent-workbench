import { NextResponse } from "next/server";
import database from "@/lib/db";
import { getUser } from "@/lib/auth";
import { readJsonObject, sameOriginError } from "@/lib/request";

export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 100) : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (title.length < 2 || content.length < 20 || content.length > 20000)
    return NextResponse.json(
      { error: "标题至少 2 字，内容需在 20～20000 字之间。" },
      { status: 400 },
    );

  const { id } = await context.params;
  const updated = database
    .prepare(
      "UPDATE knowledge_documents SET title = ?, content = ? WHERE id = ? AND user_id = ? RETURNING id, title, content, created_at",
    )
    .get(title, content, id, user.id);
  if (!updated) return NextResponse.json({ error: "资料不存在" }, { status: 404 });
  return NextResponse.json({ document: updated });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await context.params;
  const result = database
    .prepare("DELETE FROM knowledge_documents WHERE id = ? AND user_id = ?")
    .run(id, user.id);
  if (!result.changes) return NextResponse.json({ error: "资料不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
