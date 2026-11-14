export const PLANNER_MAX_OUTPUT_TOKENS = 4096;

/** Parse one Chat Completions response without accepting a truncated plan. */
export function parsePlannerResponse(payload) {
  const choice =
    payload && typeof payload === "object" && Array.isArray(payload.choices)
      ? payload.choices[0]
      : undefined;

  if (choice?.finish_reason === "length") {
    throw new Error("AI 规划回复达到长度上限，工作区尚未创建，请重试。");
  }

  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("模型没有返回可解析的计划，工作区尚未创建，请重试。");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("AI 规划结果不完整，工作区尚未创建，请重试。");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI 规划结果格式无效，工作区尚未创建，请重试。");
  }

  return parsed;
}
