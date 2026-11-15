import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { sameOriginError } from "@/lib/request";
import { DEEPSEEK_AUTH_ERROR, DEEPSEEK_MODEL, requestDeepSeekModels } from "@/lib/deepseek";
import { getDeepSeekApiKey } from "@/lib/deepseek-key.mjs";
import { isAbortError } from "@/lib/errors";
import { deepSeekModelIsAvailable } from "@/lib/deepseek-model-catalog.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  const user = await getUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "无权检查 AI 服务状态" }, { status: 403 });

  const apiKey = getDeepSeekApiKey();
  if (!apiKey)
    return NextResponse.json(
      { error: "尚未配置 DeepSeek API Key。演示模式仍可正常使用。" },
      { status: 503 },
    );

  const started = performance.now();
  try {
    const response = await requestDeepSeekModels(apiKey, 20_000, request.signal);
    if (!response.ok)
      return NextResponse.json(
        {
          error:
            response.status === 401
              ? DEEPSEEK_AUTH_ERROR
              : `DeepSeek 服务暂不可用（${response.status}）。`,
        },
        { status: response.status === 401 ? 503 : 502 },
      );

    const payload = await response.json();
    if (!deepSeekModelIsAvailable(payload, DEEPSEEK_MODEL))
      return NextResponse.json(
        { error: `DeepSeek 已连接，但模型「${DEEPSEEK_MODEL}」当前不可用。` },
        { status: 502 },
      );

    return NextResponse.json({
      model: DEEPSEEK_MODEL,
      latencyMs: Math.round(performance.now() - started),
    });
  } catch (error) {
    if (request.signal.aborted || isAbortError(error)) {
      return NextResponse.json({ error: "连接检查已取消。" }, { status: 499 });
    }
    return NextResponse.json(
      {
        error:
          error instanceof DOMException && error.name === "TimeoutError"
            ? "DeepSeek 连接超时，请稍后重试。"
            : "无法连接 DeepSeek 服务，请检查网络后重试。",
      },
      { status: error instanceof DOMException && error.name === "TimeoutError" ? 504 : 502 },
    );
  }
}
