export function parseProjectReview(text) {
  const serialized = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = JSON.parse(serialized);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof parsed.approved !== "boolean" ||
    !Array.isArray(parsed.issues) ||
    !parsed.issues.every((issue) => typeof issue === "string")
  ) {
    throw new Error("独立复核结果格式无效");
  }
  return {
    approved: parsed.approved,
    issues: parsed.issues.slice(0, 5).map((issue) => issue.slice(0, 300)),
  };
}

export function attachProjectReviewStatus(output, status, detail) {
  return {
    ...output,
    independentReview: { status, detail },
  };
}

export function ensureProjectReviewDisclosure(summary, events) {
  const reviewUnavailable = events?.some(
    (event) => event?.name === "review_project" && event?.title === "独立复核未完成",
  );
  const disclosure = "独立复核未完成（复核服务暂不可用）；项目已通过静态检查，代码未在服务器执行。";
  if (!reviewUnavailable || summary.includes("独立复核未完成")) return summary;
  return `${summary.trim()}\n\n${disclosure}`;
}

export function finalizeExecutionSummary(execution, previousResult, instruction) {
  const summary =
    previousResult && instruction.trim() && execution.events.length
      ? `已根据补充指示完成 ${execution.events.length} 次工具操作，并更新相关成果。`
      : execution.summary;
  return {
    ...execution,
    summary: ensureProjectReviewDisclosure(summary, execution.events),
  };
}
