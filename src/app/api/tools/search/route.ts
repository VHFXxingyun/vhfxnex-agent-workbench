import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { clientAddress, consumeRateLimits, rateLimitedResponse } from "@/lib/auth-rate-limit";
import { readJsonObject, sameOriginError } from "@/lib/request";
import { searchDuckDuckGo } from "@/lib/web-search.mjs";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const originError = sameOriginError(request);
  if (originError) return originError;
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "请先登录。" }, { status: 401 });

  const body = await readJsonObject(request, 4_096);
  const query = typeof body?.query === "string" ? body.query.trim().slice(0, 240) : "";
  if (query.length < 2)
    return NextResponse.json({ error: "搜索词至少需要 2 个字符。" }, { status: 400 });

  const address = clientAddress(request);
  const limit = consumeRateLimits([
    {
      key: `direct-search:account:${user.id}`,
      limit: 24,
      windowMs: 15 * 60 * 1_000,
    },
    {
      key: `direct-search:address:${address}`,
      limit: 120,
      windowMs: 15 * 60 * 1_000,
    },
  ]);
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds);

  try {
    const results = await searchDuckDuckGo(query, request.signal);
    return NextResponse.json({ query, results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "联网搜索暂时不可用。";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
