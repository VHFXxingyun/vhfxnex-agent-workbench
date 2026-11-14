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
