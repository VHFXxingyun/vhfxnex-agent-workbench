import { NextRequest, NextResponse } from "next/server";
import database, { type DbUser } from "@/lib/db";
import { getUser, publicUser } from "@/lib/auth";
import { readJsonObject } from "@/lib/request";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const body = await readJsonObject(request);
    if (!body) return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const nameLength = [...name].length;
    if (nameLength < 2 || nameLength > 48 || /[\p{Cc}\p{Cf}]/u.test(name)) {
      return NextResponse.json(
        { error: "名称需要为 2～48 个字符，且不能包含控制字符。" },
        { status: 400 },
      );
    }

    const result = database.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, user.id);
    if (result.changes !== 1) return NextResponse.json({ error: "账户不存在。" }, { status: 404 });
    const updatedUser = database.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as
      DbUser | undefined;
    if (!updatedUser) return NextResponse.json({ error: "账户不存在。" }, { status: 404 });
    return NextResponse.json({ user: publicUser(updatedUser) });
  } catch {
    return NextResponse.json({ error: "资料更新失败，请稍后重试。" }, { status: 500 });
  }
}
