import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import {
  clearSupervisorConversationForUser,
  getSupervisorConversationForUser,
} from "@/lib/supervisor-store";

export const runtime = "nodejs";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  return NextResponse.json(
    { messages: getSupervisorConversationForUser(user.id) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  clearSupervisorConversationForUser(user.id);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
