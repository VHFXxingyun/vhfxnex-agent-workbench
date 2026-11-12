import { NextRequest, NextResponse } from "next/server";
import type { ChatAttachment } from "@/lib/goal";
import { getUser } from "@/lib/auth";
import { readJsonObject } from "@/lib/request";
import { isSupportedImageDataUrl } from "@/lib/image";
import {
  cancelWorkbenchHandoffForUser,
  claimWorkbenchHandoffForUser,
  completeWorkbenchHandoffForUser,
  enqueueWorkbenchHandoffForUser,
  listPendingWorkbenchHandoffsForUser,
  releaseWorkbenchHandoffForUser,
} from "@/lib/workspace-store";

export const runtime = "nodejs";

function parseAttachments(value: unknown): ChatAttachment[] | string {
  const items = Array.isArray(value) ? value : [];
  if (items.length > 6) return "一次最多附加 6 个文件。";
  const attachments: ChatAttachment[] = [];
  let textBytes = 0;
  let imageCount = 0;
  for (const raw of items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "附件格式无效。";
    const item = raw as Record<string, unknown>;
    if (
      typeof item.name !== "string" ||
      item.name.length > 160 ||
      /[\\/\u0000-\u001f]/.test(item.name) ||
      typeof item.content !== "string"
    )
      return "附件名称或内容无效。";
    if (item.kind === "image") {
      imageCount += 1;
      if (
        imageCount > 1 ||
        typeof item.mimeType !== "string" ||
        !isSupportedImageDataUrl(item.content) ||
        !item.content.startsWith(`data:${item.mimeType};base64,`)
      )
        return "图片附件最多 1 张，且仅支持有效的 JPG、PNG、GIF 或 WebP。";
      attachments.push({
        id: crypto.randomUUID(),
        name: item.name,
        mimeType: item.mimeType,
        kind: "image",
        content: item.content,
      });
    } else if (item.kind === "text" && typeof item.mimeType === "string") {
      textBytes += new TextEncoder().encode(item.content).byteLength;
      if (item.content.length > 120_000 || textBytes > 200_000)
        return "文本附件总量不能超过 200 KB。";
      attachments.push({
        id: crypto.randomUUID(),
        name: item.name,
        mimeType: item.mimeType.slice(0, 100),
        kind: "text",
        content: item.content,
      });
    } else {
      return "附件类型无效。";
    }
  }
  return attachments;
}

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  return NextResponse.json(
    { handoffs: listPendingWorkbenchHandoffsForUser(user.id) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const body = await readJsonObject(request, 8_500_000);
  if (!body) return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const userMessageId = typeof body.userMessageId === "string" ? body.userMessageId.trim() : "";
  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  const userMessage = typeof body.userMessage === "string" ? body.userMessage.trim() : "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId) ||
    !userMessageId ||
    userMessageId.length > 80 ||
    !instruction ||
    instruction.length > 4000 ||
    userMessage.length > 4000
  )
    return NextResponse.json({ error: "交接信息不完整或格式无效。" }, { status: 400 });
  const attachments = parseAttachments(body.attachments);
  if (typeof attachments === "string")
    return NextResponse.json({ error: attachments }, { status: 400 });

  const result = enqueueWorkbenchHandoffForUser(user.id, {
    id: crypto.randomUUID(),
    workspaceId,
    instruction,
    userMessageId,
    userMessage,
    attachments,
  });
  if (result.status === "missing")
    return NextResponse.json({ error: "目标工作区已不存在。" }, { status: 404 });
  if (result.status === "invalid")
    return NextResponse.json({ error: "找不到对应的聊天交接记录，请重新发送。" }, { status: 409 });
  if (result.status === "limit")
    return NextResponse.json(
      { error: "待执行任务或附件已达到保存上限；完成或取消一些任务后再试。" },
      { status: 409 },
    );
  return NextResponse.json({
    handoff: result.handoff,
    existing: result.status === "existing",
    completed: result.status === "completed",
    cancelled: result.status === "cancelled",
  });
}

export async function PATCH(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const body = await readJsonObject(request, 20_000);
  if (!body) return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const action = typeof body.action === "string" ? body.action : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!id || id.length > 80) return NextResponse.json({ error: "任务标识无效。" }, { status: 400 });

  if (action === "claim") {
    const claimToken = crypto.randomUUID();
    const result = claimWorkbenchHandoffForUser(user.id, id, claimToken);
    if (result.status === "missing") return NextResponse.json({ status: "missing" });
    if (result.status === "busy") return NextResponse.json({ status: "busy" });
    return NextResponse.json({ status: "claimed", handoff: result.handoff, token: claimToken });
  }
  if (!token) return NextResponse.json({ error: "任务确认标识缺失。" }, { status: 400 });
  if (action === "release") {
    return NextResponse.json({ ok: releaseWorkbenchHandoffForUser(user.id, id, token) });
  }
  if (action === "complete") {
    return NextResponse.json({ ok: completeWorkbenchHandoffForUser(user.id, id, token) });
  }
  if (action === "cancel") {
    return NextResponse.json({ ok: cancelWorkbenchHandoffForUser(user.id, id, token) });
  }
  return NextResponse.json({ error: "任务操作无效。" }, { status: 400 });
}
