export const WORKBENCH_MAX_ATTEMPTS = 3;

const transientNetworkError =
  /(?:fetch failed|failed to fetch|network(?:error| request)?|socket hang up|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|timed? ?out|aborted due to timeout|temporarily unavailable)/i;
const transientDatabaseContentionError =
  /(?:SQLITE_BUSY(?:_SNAPSHOT)?|SQLITE_LOCKED|database (?:table )?is locked)/i;
const incompleteDeliverableError =
  /(?:Agent 未能完成(?:可运行代码项目|(?=[^。！？\n]{0,160}(?:任务|时间线|行动方案|可运行代码项目|预算核算|PDF 文件|Excel 工作簿|PowerPoint 演示稿|具体日程时段|联网搜索)))|Agent 未能新增你指定的任务|Agent 未能补齐必需产物|Agent 未生成可下载的|代码项目生成校验未通过|代码项目仍在分批生成|本轮未能完成现有代码项目更新|本轮未能完成代码项目处理|本轮未能生成新的可下载代码项目|Agent 未能生成具体日程时段|联网搜索没有成功完成|可行性复核(?:仍未通过|发现|未完成)|本轮未取得可行性复核结果|方案在上次通过复核后又有修改|上次复核发现冲突|did not contain a call to the required tool)/i;

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
  if (
    transientNetworkError.test(message) ||
    transientDatabaseContentionError.test(message) ||
    /AbortError/i.test(message)
  )
    return { retryable: true, retryAfterMs: 15_000, outcome: "retry" };

  return { retryable: false, retryAfterMs: 0, outcome: "failed" };
}
