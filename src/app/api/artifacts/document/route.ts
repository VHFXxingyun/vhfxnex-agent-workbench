import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { readJsonObject, sameOriginError } from "@/lib/request";
import { createDocxFromTemplate, readDocxTemplateForUser } from "@/lib/docx-template.mjs";
import { getWorkspaceForUser } from "@/lib/workspace-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  // A complete Chinese plan can be tens of thousands of characters. The
  // request limit is in UTF-8 bytes, so leave room for three-byte CJK text.
  const body = await readJsonObject(request, 160_000);
  if (
    !body ||
    typeof body.workspaceId !== "string" ||
    typeof body.artifactId !== "string" ||
    typeof body.content !== "string" ||
    body.content.length > 40_000
  )
    return NextResponse.json({ error: "Word 文档导出数据无效。" }, { status: 400 });

  const workspace = getWorkspaceForUser(user.id, body.workspaceId);
  const artifact = workspace?.result?.artifacts.find(
    (item) => item.id === body.artifactId && item.type === "document",
  );
  if (!artifact?.templateId)
    return NextResponse.json({ error: "找不到与此成果关联的 DOCX 模板。" }, { status: 404 });

  try {
    const template = readDocxTemplateForUser(user.id, artifact.templateId);
    const bytes = await createDocxFromTemplate(template, body.content);
    const filename = `${artifact.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim() || "VHFXNEX-方案"}.docx`;
    const encodedFilename = encodeURIComponent(filename).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    const responseBody = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(responseBody).set(bytes);
    return new NextResponse(responseBody, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="vhfxnex-document.docx"; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DOCX 文件生成失败。";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
