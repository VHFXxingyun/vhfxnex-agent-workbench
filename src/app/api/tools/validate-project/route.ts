import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { readJsonObject, sameOriginError } from "@/lib/request";
import { projectFileRequirements } from "@/lib/agent-tools.mjs";
import { validateGeneratedProject } from "@/lib/project-static-validation.mjs";
import { normalizeProjectPath, projectPathKey } from "@/lib/project-path.mjs";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  if (!(await getUser())) return NextResponse.json({ error: "请先登录。" }, { status: 401 });

  const body = await readJsonObject(request, 160_000);
  if (!body || !Array.isArray(body.files) || body.files.length === 0 || body.files.length > 40)
    return NextResponse.json({ error: "请提供 1 到 40 个项目文件。" }, { status: 400 });

  const files: { path: string; content: string }[] = [];
  const pathKeys = new Set<string>();
  let totalCharacters = 0;
  for (const raw of body.files) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return NextResponse.json({ error: "项目文件格式无效。" }, { status: 400 });
    const file = raw as Record<string, unknown>;
    if (typeof file.path !== "string" || typeof file.content !== "string")
      return NextResponse.json({ error: "每个项目文件都需要路径和文本内容。" }, { status: 400 });
    const normalizedPath = normalizeProjectPath(file.path);
    if (!normalizedPath)
      return NextResponse.json(
        { error: `文件路径不安全或无效：${file.path.slice(0, 80)}` },
        { status: 400 },
      );
    const pathKey = projectPathKey(normalizedPath);
    if (pathKeys.has(pathKey))
      return NextResponse.json({ error: `存在重复文件路径：${normalizedPath}` }, { status: 400 });
    pathKeys.add(pathKey);
    totalCharacters += normalizedPath.length + file.content.length;
    if (file.path.length > 180 || file.content.length > 80_000 || totalCharacters > 120_000)
      return NextResponse.json(
        { error: "项目内容超过安全上限，请拆分后再检查。" },
        { status: 413 },
      );
    files.push({ path: normalizedPath, content: file.content });
  }

  try {
    return NextResponse.json({
      issues: [...projectFileRequirements(files), ...validateGeneratedProject(files)],
    });
  } catch {
    return NextResponse.json(
      { error: "静态检查未能完成，请检查文件内容后重试。" },
      { status: 400 },
    );
  }
}
