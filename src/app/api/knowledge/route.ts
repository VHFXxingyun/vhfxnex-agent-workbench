import { NextRequest, NextResponse } from "next/server";
import database, { type DbKnowledge } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { readJsonObject } from "@/lib/request";
import { accountDataLimits } from "@/lib/limits";

export const runtime = "nodejs";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const documents = database
    .prepare(
      "SELECT id, title, content, created_at FROM knowledge_documents WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(user.id, accountDataLimits.knowledgeDocuments) as Omit<DbKnowledge, "user_id">[];
  return NextResponse.json({ documents });
}

export async function POST(request: NextRequest) {
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
  const document = {
    id: crypto.randomUUID(),
    title,
    content,
    created_at: new Date().toISOString(),
  };
  const created = database.transaction(() => {
    const count = (
      database
        .prepare("SELECT COUNT(*) AS count FROM knowledge_documents WHERE user_id = ?")
        .get(user.id) as { count: number }
    ).count;
    if (count >= accountDataLimits.knowledgeDocuments) return false;
    database
      .prepare(
        "INSERT INTO knowledge_documents (id, user_id, title, content, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(document.id, user.id, title, content, document.created_at);
    return true;
  })();
  if (!created)
    return NextResponse.json(
      { error: `知识库最多保存 ${accountDataLimits.knowledgeDocuments} 篇资料。` },
      { status: 409 },
    );
  return NextResponse.json({ document }, { status: 201 });
}
