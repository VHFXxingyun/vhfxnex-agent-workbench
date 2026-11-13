export function parseDeepSeekUsage(payload, latencyMs, fallbackModel = "deepseek-flash") {
  if (!payload || typeof payload !== "object") return undefined;
  const response = payload;
  const usage = response.usage;
  if (!usage || typeof usage !== "object") return undefined;
  const readCount = (value) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const inputTokens = readCount(usage.prompt_tokens);
  const outputTokens = readCount(usage.completion_tokens);
  const totalTokens = readCount(usage.total_tokens) || inputTokens + outputTokens;
  if (!totalTokens) return undefined;
  const cacheReadTokens = getDeepSeekCacheHitTokens(usage, inputTokens);
  return {
    model:
      typeof response.model === "string" && response.model.trim()
        ? response.model.trim().slice(0, 80)
        : fallbackModel,
    inputTokens,
    ...(cacheReadTokens !== undefined
      ? {
          cachedInputTokens: cacheReadTokens,
          cacheMeasuredInputTokens: inputTokens,
          cacheMeasuredHitTokens: cacheReadTokens,
        }
      : {}),
    outputTokens,
    totalTokens,
    latencyMs: Math.max(0, Math.round(latencyMs)),
    requests: 1,
  };
}

/** Read cache statistics only when the provider included a cache field in its raw usage. */
export function getDeepSeekCacheHitTokens(rawUsage, inputTokens) {
  if (
    !rawUsage ||
    typeof rawUsage !== "object" ||
    !Number.isSafeInteger(inputTokens) ||
    inputTokens < 0
  )
    return undefined;
  const reportedCacheHitTokens = [
    rawUsage.prompt_cache_hit_tokens,
    rawUsage.prompt_tokens_details?.cached_tokens,
  ].find(
    (value) =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
  );
  if (
    reportedCacheHitTokens === undefined
  )
    return undefined;
  return Math.min(inputTokens, reportedCacheHitTokens);
}
