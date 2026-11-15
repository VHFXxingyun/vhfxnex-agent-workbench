export const DEEPSEEK_MODELS_URL: string;
export function deepSeekModelIsAvailable(payload: unknown, modelId: string): boolean;
export function requestDeepSeekModels(
  apiKey: string,
  timeoutMs: number,
  requestSignal?: AbortSignal,
  fetcher?: typeof fetch,
): Promise<Response>;
