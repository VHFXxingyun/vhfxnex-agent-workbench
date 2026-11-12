import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { parseToolArguments } from "@/lib/agent-tools.mjs";
import { readJsonObject, sameOriginError } from "@/lib/request";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  if (!(await getUser())) return NextResponse.json({ error: "请先登录。" }, { status: 401 });

  const body = await readJsonObject(request, 70_000);
  if (!body) return NextResponse.json({ error: "请求格式无效。" }, { status: 400 });
  if (
    typeof body.title !== "string" ||
    typeof body.description !== "string" ||
    typeof body.content !== "string"
  ) {
    return NextResponse.json({ error: "演示稿数据无效。" }, { status: 400 });
  }

  let slides: unknown;
  try {
    const parsedContent = JSON.parse(body.content) as { slides?: unknown };
    slides = parsedContent.slides;
  } catch {
    return NextResponse.json({ error: "演示稿内容不是有效 JSON。" }, { status: 400 });
  }

  const parsed = parseToolArguments(
    "generate_presentation",
    JSON.stringify({ title: body.title, description: body.description, slides }),
  );
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const presentation = parsed.args as {
    title: string;
    slides: { title: string; bullets: string[]; speakerNotes?: string }[];
  };

  try {
    const { default: PptxGenJS } = await import("pptxgenjs");
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "VHFXNEX Agent";
    pptx.subject = "Agent 生成的演示文稿";
    pptx.title = presentation.title;
    pptx.company = "VHFXNEX";
    pptx.theme = { headFontFace: "Aptos Display", bodyFontFace: "Aptos" };

    presentation.slides.forEach((item, index) => {
      const slide = pptx.addSlide();
      slide.background = { color: "171620" };
      slide.addText(presentation.title, {
        x: 0.55,
        y: 0.32,
        w: 11.9,
        h: 0.25,
        fontFace: "Aptos",
        fontSize: 9,
        color: "BDA7E2",
        charSpacing: 1.2,
        breakLine: false,
      });
      slide.addShape(pptx.ShapeType.line, {
        x: 0.55,
        y: 0.76,
        w: 12.25,
        h: 0,
        line: { color: "FFFFFF", transparency: 85, width: 0.6 },
      });
      slide.addText(item.title, {
        x: 0.75,
        y: 1.12,
        w: 11.3,
        h: 0.75,
        fontFace: "Aptos Display",
        fontSize: index === 0 ? 32 : 28,
        bold: true,
        color: "F4F0F8",
        breakLine: false,
        fit: "shrink",
      });
      if (item.bullets.length) {
        slide.addText(
          item.bullets.map((text) => ({
            text,
            options: { bullet: { indent: 18 }, hanging: 4, breakLine: true },
          })),
          {
            x: 1.02,
            y: 2.25,
            w: 10.8,
            h: 4.0,
            fontFace: "Aptos",
            fontSize: 18,
            color: "D4D0DC",
            breakLine: false,
            paraSpaceAfter: 18,
            valign: "middle",
            fit: "shrink",
          },
        );
      }
      slide.addText(`${String(index + 1).padStart(2, "0")} / ${presentation.slides.length}`, {
        x: 11.7,
        y: 7.0,
        w: 0.9,
        h: 0.2,
        fontSize: 9,
        color: "AAA3B6",
        align: "right",
      });
      if (item.speakerNotes) slide.addNotes(item.speakerNotes);
    });

    const output = await pptx.write({ outputType: "blob" });
    if (!(output instanceof Blob)) throw new Error("PowerPoint 文件打包失败。");
    return new NextResponse(output, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": "attachment; filename=goalflow-presentation.pptx",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Presentation export failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "PowerPoint 文件生成失败，请稍后重试。" }, { status: 500 });
  }
}
