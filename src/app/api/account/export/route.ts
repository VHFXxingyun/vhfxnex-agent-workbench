import { NextResponse } from "next/server";
import database, { type DbKnowledge, type DbWorkspace } from "@/lib/db";
import { getUser, publicUser } from "@/lib/auth";
import { isWorkspace } from "@/lib/workspace-validation";
import { accountDataLimits } from "@/lib/limits";

export const runtime = "nodejs";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const workspaceRows = database
    .prepare("SELECT * FROM workspaces WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?")
    .all(user.id, accountDataLimits.workspaces) as DbWorkspace[];
  const workspaces = workspaceRows.flatMap((row) => {
    try {
      const value: unknown = JSON.parse(row.body);
      return isWorkspace(value) ? [value] : [];
    } catch {
      return [];
    }
  });
  const knowledge = database
    .prepare(
      "SELECT id, title, content, created_at FROM knowledge_documents WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(user.id, accountDataLimits.knowledgeDocuments) as Omit<DbKnowledge, "user_id">[];

  return NextResponse.json(
    {
      brand: "VHFXNEX",
      format: "nexora-account-backup",
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      user: publicUser(user),
      workspaces,
      knowledge,
    },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
