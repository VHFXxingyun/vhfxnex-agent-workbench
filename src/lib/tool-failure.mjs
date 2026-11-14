export function compactToolFailure(value) {
  let current = value;
  const seen = new Set();
  for (let depth = 0; depth < 6; depth += 1) {
    if (!current || typeof current !== "object" || !("cause" in current) || !current.cause) break;
    if (seen.has(current.cause)) break;
    seen.add(current.cause);
    current = current.cause;
  }

  const issues = current && typeof current === "object" ? current.issues : undefined;
  const issueSummary = Array.isArray(issues)
    ? issues
        .slice(0, 5)
        .map((issue) => {
          if (!issue || typeof issue !== "object") return "";
          const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
          const message = typeof issue.message === "string" ? issue.message : "参数格式无效";
          return `${path ? `${path}：` : ""}${message}`;
        })
        .filter(Boolean)
        .join("；")
    : "";
  const message =
    issueSummary ||
    (current instanceof Error
      ? current.message
      : current && typeof current === "object" && "message" in current
        ? String(current.message)
        : String(current || "工具参数未通过校验"));
  if (/AI_JSONParseError|JSON parsing failed|Unexpected end of JSON input/i.test(message))
    return "工具参数 JSON 不完整或被截断；请缩小本次产物范围后重新生成。";
  const validationReason = message.match(
    /Type validation failed(?: for [^:]+)?: Value:[\s\S]*?\nError message:\s*([\s\S]*)$/i,
  )?.[1];
  return (
    (validationReason || message).replace(/\s+/g, " ").trim().slice(0, 500) || "工具参数未通过校验"
  );
}
