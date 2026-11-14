import type { AiRunUsage } from "@/lib/goal";
import { parseDeepSeekUsage } from "@/lib/deepseek-usage.mjs";
export { getDeepSeekUserId } from "@/lib/deepseek-user-id.mjs";

export const DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";
// Stable API ID currently routed to DeepSeek-V4.1-Flash-1017.
export const DEEPSEEK_MODEL = "deepseek-flash";
export const DEEPSEEK_AUTH_ERROR =
  "DeepSeek 返回 401，拒绝了服务端当前加载的凭证。请求已到达平台，但 Key 无效或已失效；请核对 DeepSeek 控制台中的 Key 状态。密钥不会显示在此处。";

export function requestDeepSeek(
  apiKey: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
  requestSignal?: AbortSignal,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return fetch(DEEPSEEK_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      thinking: { type: "disabled" },
      ...payload,
    }),
    cache: "no-store",
    signal: requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal,
  });
}

export function readDeepSeekUsage(payload: unknown, latencyMs: number): AiRunUsage | undefined {
  return parseDeepSeekUsage(payload, latencyMs, DEEPSEEK_MODEL);
}
