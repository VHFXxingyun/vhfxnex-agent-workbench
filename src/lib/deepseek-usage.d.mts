export function parseDeepSeekUsage(
  payload: unknown,
  latencyMs: number,
  fallbackModel?: string,
):
  | {
      model: string;
      inputTokens: number;
      cachedInputTokens?: number;
      outputTokens: number;
      totalTokens: number;
      latencyMs: number;
      requests: number;
    }
  | undefined;
