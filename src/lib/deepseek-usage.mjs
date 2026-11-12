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
  const nestedCachedTokens = usage.prompt_tokens_details?.cached_tokens;
  const reportedCacheReadTokens = usage.prompt_cache_hit_tokens ?? nestedCachedTokens;
  const cacheReadTokens = readCount(reportedCacheReadTokens);
  return {
    model:
      typeof response.model === "string" && response.model.trim()
        ? response.model.trim().slice(0, 80)
        : fallbackModel,
    inputTokens,
    ...(reportedCacheReadTokens !== undefined
      ? { cachedInputTokens: Math.min(inputTokens, cacheReadTokens) }
      : {}),
    outputTokens,
    totalTokens,
    latencyMs: Math.max(0, Math.round(latencyMs)),
    requests: 1,
  };
}
