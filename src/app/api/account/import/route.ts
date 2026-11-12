import { NextRequest, NextResponse } from "next/server";
import database, { type DbKnowledge } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { readJsonObject } from "@/lib/request";
import { isWorkspace } from "@/lib/workspace-validation";
import { accountDataLimits } from "@/lib/limits";
import type { Workspace } from "@/lib/goal";

export const runtime = "nodejs";

type ImportedKnowledge = Pick<DbKnowledge, "id" | "title" | "content" | "created_at">;

function rekeyWorkspace(workspace: Workspace, knowledgeIds: Map<string, string>): Workspace {
  return {
    ...workspace,
    id: crypto.randomUUID(),
    plan: {
      ...workspace.plan,
      routes: workspace.plan.routes.map((route) => ({ ...route })),
      tasks: workspace.plan.tasks.map((task) => ({ ...task, id: crypto.randomUUID() })),
      sources: workspace.plan.sources.map((source) => ({
        ...source,
        id: knowledgeIds.get(source.id) || source.id,
      })),
    },
    result: workspace.result
      ? {
          ...workspace.result,
          tasks: workspace.result.tasks.map((task) => ({ ...task, id: crypto.randomUUID() })),
          artifacts: workspace.result.artifacts.map((artifact) => ({
            ...artifact,
            id: crypto.randomUUID(),
          })),
          events: workspace.result.events.map((event) => ({ ...event, id: crypto.randomUUID() })),
          milestones: workspace.result.milestones.map((milestone) => ({ ...milestone })),
          budget: workspace.result.budget ? { ...workspace.result.budget } : undefined,
        }
      : null,
  };
}

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const backup = await readJsonObject(request, accountDataLimits.backupBytes);
  if (!backup) {
    return NextResponse.json(
      { error: `备份文件无法读取或超过 ${accountDataLimits.backupBytes / 1_000_000} MB。` },
      { status: 400 },
    );
  }
  if (
    backup.format !== "nexora-account-backup" ||
    backup.formatVersion !== 1 ||
    !Array.isArray(backup.workspaces) ||
    backup.workspaces.length > accountDataLimits.workspaces ||
    !Array.isArray(backup.knowledge) ||
    backup.knowledge.length > accountDataLimits.knowledgeDocuments
  ) {
    return NextResponse.json({ error: "备份格式或版本不受支持。" }, { status: 400 });
  }

  const importedIds = new Set<string>();
  const knowledgeIds = new Map<string, string>();
  const knowledge: ImportedKnowledge[] = [];
  for (const raw of backup.knowledge) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return NextResponse.json({ error: "备份中的知识资料格式无效。" }, { status: 400 });
    }
    const item = raw as Record<string, unknown>;
    const sourceId = typeof item.id === "string" ? item.id : "";
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const content = typeof item.content === "string" ? item.content.trim() : "";
    const createdAt = typeof item.created_at === "string" ? item.created_at : "";
    if (
      !sourceId ||
      importedIds.has(`knowledge:${sourceId}`) ||
      title.length < 2 ||
      title.length > 100 ||
      content.length < 20 ||
      content.length > 20_000
    ) {
      return NextResponse.json({ error: "备份中的知识资料内容无效。" }, { status: 400 });
    }
    importedIds.add(`knowledge:${sourceId}`);
    const id = crypto.randomUUID();
    knowledgeIds.set(sourceId, id);
    knowledge.push({
      id,
      title,
      content,
      created_at: Number.isFinite(Date.parse(createdAt)) ? createdAt : new Date().toISOString(),
    });
  }

  const workspaces: Workspace[] = [];
  const workspaceSourceIds = new Set<string>();
  for (const raw of backup.workspaces) {
    if (!isWorkspace(raw)) {
      return NextResponse.json({ error: "备份中的工作空间数据无效。" }, { status: 400 });
    }
    if (Buffer.byteLength(JSON.stringify(raw), "utf8") > accountDataLimits.workspaceBytes) {
      return NextResponse.json({ error: "备份中的工作空间超过 250 KB 上限。" }, { status: 400 });
    }
    if (workspaceSourceIds.has(raw.id)) {
      return NextResponse.json({ error: "备份中包含重复的工作空间 ID。" }, { status: 400 });
    }
    workspaceSourceIds.add(raw.id);
    const importedWorkspace = rekeyWorkspace(raw, knowledgeIds);
    if (
      Buffer.byteLength(JSON.stringify(importedWorkspace), "utf8") >
      accountDataLimits.workspaceBytes
    ) {
      return NextResponse.json(
        { error: "重新映射 ID 后工作空间超过 250 KB 上限，无法安全导入。" },
        { status: 400 },
      );
    }
    workspaces.push(importedWorkspace);
  }

  const now = new Date().toISOString();
  const saveImport = database.transaction(() => {
    const existingWorkspaceCount = (
      database
        .prepare("SELECT COUNT(*) AS count FROM workspaces WHERE user_id = ?")
        .get(user.id) as { count: number }
    ).count;
    if (existingWorkspaceCount + workspaces.length > accountDataLimits.workspaces) {
      return {
        error: `导入后工作空间会超过 ${accountDataLimits.workspaces} 个上限，请先删除不需要的目标。`,
      };
    }
    const existingKnowledgeCount = (
      database
        .prepare("SELECT COUNT(*) AS count FROM knowledge_documents WHERE user_id = ?")
        .get(user.id) as { count: number }
    ).count;
    if (existingKnowledgeCount + knowledge.length > accountDataLimits.knowledgeDocuments) {
      return {
        error: `导入后知识资料会超过 ${accountDataLimits.knowledgeDocuments} 篇上限，请先清理知识库后重试。`,
      };
    }
    for (const item of knowledge) {
      database
        .prepare(
          "INSERT INTO knowledge_documents (id, user_id, title, content, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(item.id, user.id, item.title, item.content, item.created_at);
    }
    for (const workspace of workspaces) {
      database
        .prepare(
          "INSERT INTO workspaces (id, user_id, title, category, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          workspace.id,
          user.id,
          workspace.plan.title,
          workspace.plan.category,
          JSON.stringify(workspace),
          workspace.createdAt || now,
          now,
        );
    }
    return null;
  });
  const importError = saveImport();
  if (importError) return NextResponse.json(importError, { status: 409 });

  return NextResponse.json(
    { imported: { workspaces: workspaces.length, knowledge: knowledge.length } },
    { status: 201 },
  );
}
