import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { parseToolArguments } from "@/lib/agent-tools.mjs";
import { readJsonObject, sameOriginError } from "@/lib/request";
import { createPdfDocument } from "@/lib/pdf-export";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  if (!(await getUser())) return NextResponse.json({ error: "请先登录。" }, { status: 401 });

  const body = await readJsonObject(request, 70_000);
  if (
    !body ||
    typeof body.title !== "string" ||
    typeof body.description !== "string" ||
    typeof body.content !== "string"
  ) {
    return NextResponse.json({ error: "PDF 文档数据无效。" }, { status: 400 });
  }
  const parsed = parseToolArguments(
    "generate_pdf",
    JSON.stringify({ title: body.title, description: body.description, content: body.content }),
  );
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const document = parsed.args as { title: string; description: string; content: string };

  try {
    const pdf = await createPdfDocument(document.title, document.description, document.content);
    const filename = `${document.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim() || "vhfxnex-document"}.pdf`;
    const encodedFilename = encodeURIComponent(filename).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    const body = new ArrayBuffer(pdf.byteLength);
    new Uint8Array(body).set(pdf);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="vhfxnex-document.pdf"; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("PDF export failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "PDF 文件生成失败，请稍后重试。" }, { status: 500 });
  }
}
