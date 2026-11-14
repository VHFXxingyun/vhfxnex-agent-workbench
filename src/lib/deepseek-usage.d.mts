export function parseDeepSeekUsage(
  payload: unknown,
  latencyMs: number,
  fallbackModel?: string,
):
  | {
      model: string;
      inputTokens: number;
      cachedInputTokens?: number;
      cacheMeasuredInputTokens?: number;
      cacheMeasuredHitTokens?: number;
      outputTokens: number;
      reasoningTokens?: number;
      reasoningMeasuredRequests?: number;
      totalTokens: number;
      latencyMs: number;
      requests: number;
    }
  | undefined;
export function getDeepSeekCacheHitTokens(
  rawUsage: unknown,
  inputTokens: number,
): number | undefined;
export function getDeepSeekReasoningTokens(
  rawUsage: unknown,
  outputTokens: number,
): number | undefined;
