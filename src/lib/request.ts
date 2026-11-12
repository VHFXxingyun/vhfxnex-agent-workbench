import { NextResponse } from "next/server";

export function isSameOriginRequest(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin") return false;

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const source = origin || referer;
  if (!source) return true;
  try {
    const requestUrl = new URL(request.url);
    const requestHost = request.headers.get("host");
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0].trim();
    const requestProtocol = forwardedProtocol || requestUrl.protocol.slice(0, -1);
    const requestOrigin = requestHost
      ? new URL(`${requestProtocol}://${requestHost}`).origin
      : requestUrl.origin;
    return new URL(source).origin === requestOrigin;
  } catch {
    return false;
  }
}

export function sameOriginError(request: Request) {
  if (isSameOriginRequest(request)) return null;
  return NextResponse.json({ error: "跨站请求被拒绝。" }, { status: 403 });
}

export async function readJsonObject(
  request: Request,
  maxBytes = 1_000_000,
): Promise<Record<string, unknown> | null> {
  try {
    if (!isSameOriginRequest(request)) return null;
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") return null;

    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) return null;

    const reader = request.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
