export const WORKBENCH_MAX_ATTEMPTS = 3;

const transientNetworkError =
  /(?:fetch failed|failed to fetch|network(?:error| request)?|socket hang up|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|timed? ?out|aborted due to timeout|temporarily unavailable)/i;
const incompleteDeliverableError =
  /(?:Agent 未能完成可运行代码项目|Agent 未生成可下载的|代码项目生成校验未通过|代码项目仍在分批生成|本轮未能完成现有代码项目更新|Agent 未能生成具体日程时段|联网搜索没有成功完成|可行性复核仍未通过)/i;

export function classifyWorkbenchFailure({ status, error, cancelled = false } = {}) {
  if (cancelled) return { retryable: false, retryAfterMs: 0, outcome: "cancelled" };

  if (Number.isInteger(status)) {
    if (
      status === 408 ||
      status === 425 ||
      status === 429 ||
      (status >= 500 && status !== 501 && status !== 505)
    )
      return {
        retryable: true,
        retryAfterMs: status === 429 ? 60_000 : 15_000,
        outcome: "retry",
      };
    return { retryable: false, retryAfterMs: 0, outcome: "failed" };
  }

  const message =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? `${error.name}: ${error.message}`
        : "";
  if (incompleteDeliverableError.test(message))
    return {
      retryable: true,
      retryAfterMs: 15_000,
      maxAttempts: 2,
      outcome: "retry",
    };
  if (transientNetworkError.test(message) || /AbortError/i.test(message))
    return { retryable: true, retryAfterMs: 15_000, outcome: "retry" };

  return { retryable: false, retryAfterMs: 0, outcome: "failed" };
}
