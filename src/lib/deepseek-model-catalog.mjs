export const DEEPSEEK_MODELS_URL = "https://api.deepseek.com/models";

/** @param {unknown} payload @param {string} modelId */
export function deepSeekModelIsAvailable(payload, modelId) {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    Array.isArray(payload.data) &&
    payload.data.some((model) => model?.id === modelId),
  );
}

/**
 * @param {string} apiKey
 * @param {number} timeoutMs
 * @param {AbortSignal | undefined} requestSignal
 * @param {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} [fetcher=fetch]
 * @returns {Promise<Response>}
 */
export function requestDeepSeekModels(apiKey, timeoutMs, requestSignal, fetcher = fetch) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return fetcher(DEEPSEEK_MODELS_URL, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
    signal: requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal,
  });
}
