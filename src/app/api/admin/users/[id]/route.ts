import { NextRequest, NextResponse } from "next/server";
import database from "@/lib/db";
import { getUser } from "@/lib/auth";
import { readJsonObject, sameOriginError } from "@/lib/request";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  const actor = await getUser();
  if (!actor || actor.role !== "admin")
    return NextResponse.json({ error: "无权修改账户权限" }, { status: 403 });
  const { id } = await context.params;
  if (id === actor.id)
    return NextResponse.json({ error: "不能修改自己的管理员权限" }, { status: 400 });
  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
  if (body.role !== "admin" && body.role !== "member")
    return NextResponse.json({ error: "权限类型无效" }, { status: 400 });
  const result = database.prepare("UPDATE users SET role = ? WHERE id = ?").run(body.role, id);
  if (!result.changes) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  const actor = await getUser();
  if (!actor || actor.role !== "admin")
    return NextResponse.json({ error: "无权删除账户" }, { status: 403 });
  const { id } = await context.params;
  if (id === actor.id)
    return NextResponse.json({ error: "不能删除当前登录的管理员账户" }, { status: 400 });

  const result = database.transaction(() => {
    const target = database.prepare("SELECT role FROM users WHERE id = ?").get(id) as
      { role: "admin" | "member" } | undefined;
    if (!target) return "missing";
    if (target.role === "admin") {
      const admins = (
        database.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get() as {
          count: number;
        }
      ).count;
      if (admins <= 1) return "last-admin";
    }
    database.prepare("DELETE FROM ai_usage WHERE user_id = ?").run(id);
    database.prepare("DELETE FROM knowledge_documents WHERE user_id = ?").run(id);
    database.prepare("DELETE FROM workspaces WHERE user_id = ?").run(id);
    database.prepare("DELETE FROM users WHERE id = ?").run(id);
    return "deleted";
  })();

  if (result === "missing") return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  if (result === "last-admin")
    return NextResponse.json({ error: "不能删除最后一位管理员" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
