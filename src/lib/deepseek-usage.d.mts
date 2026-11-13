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
      totalTokens: number;
      latencyMs: number;
      requests: number;
    }
  | undefined;
export function getDeepSeekCacheHitTokens(rawUsage: unknown, inputTokens: number): number | undefined;
