const MAX_SEARCH_HTML = 1_000_000;

function decodeHtml(value) {
  const decodeCodePoint = (codePoint) =>
    Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : "\uFFFD";
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code) => decodeCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => decodeCodePoint(parseInt(code, 16)));
}

function cleanText(value) {
  return decodeHtml(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match ? decodeHtml(match[2]) : "";
}

function unwrapDuckDuckGoUrl(href) {
  try {
    const normalized = href.startsWith("//") ? `https:${href}` : href;
    const parsed = new URL(normalized);
    if (parsed.hostname === "duckduckgo.com" && parsed.pathname === "/l/") {
      const target = parsed.searchParams.get("uddg");
      if (!target) return "";
      return target;
    }
    return parsed.href;
  } catch {
    return "";
  }
}

export function parseDuckDuckGoResults(html, limit = 5) {
  if (typeof html !== "string" || html.length > MAX_SEARCH_HTML) return [];
  const anchors =
    html.match(/<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*>[\s\S]*?<\/a>/gi) || [];
  const snippets =
    html.match(/<a\b[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>[\s\S]*?<\/a>/gi) || [];
  const results = [];
  for (let index = 0; index < anchors.length && results.length < Math.min(5, limit); index += 1) {
    const tag = anchors[index].match(/^<a\b[^>]*>/i)?.[0] || "";
    const url = unwrapDuckDuckGoUrl(attribute(tag, "href"));
    const title = cleanText(anchors[index].replace(/^<a\b[^>]*>/i, "").replace(/<\/a>$/i, ""));
    const snippet = cleanText(
      snippets[index]?.replace(/^<a\b[^>]*>/i, "").replace(/<\/a>$/i, "") || "",
    );
    if (!title || !snippet) continue;
    try {
      const parsed = new URL(url);
      if (
        (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
        parsed.username ||
        parsed.password
      )
        continue;
      results.push({
        title: title.slice(0, 300),
        url: parsed.href.slice(0, 2000),
        snippet: snippet.slice(0, 1200),
      });
    } catch {
      // Ignore malformed or relative result URLs.
    }
  }
  return results;
}

async function readSearchHtml(response) {
  const contentLength = response.headers.get("content-length");
  if (/^\d+$/.test(contentLength || "") && Number(contentLength) > MAX_SEARCH_HTML) {
    await response.body?.cancel().catch(() => {});
    throw new Error("搜索服务返回内容超过安全上限。");
  }

  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_SEARCH_HTML) {
        await reader.cancel().catch(() => {});
        throw new Error("搜索服务返回内容超过安全上限。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export async function searchDuckDuckGo(query, signal) {
  const cleanedQuery = String(query || "")
    .trim()
    .slice(0, 240);
  if (cleanedQuery.length < 2) throw new Error("搜索词至少需要 2 个字符。");
  const timeout = AbortSignal.timeout(12_000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(
    `https://html.duckduckgo.com/html/?${new URLSearchParams({ q: cleanedQuery })}`,
    {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
        "User-Agent": "Mozilla/5.0 (compatible; GoalflowSearch/1.0)",
      },
      signal: combinedSignal,
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error(`联网搜索暂时不可用（HTTP ${response.status}）。`);
  const html = await readSearchHtml(response);
  const results = parseDuckDuckGoResults(html);
  if (!results.length) throw new Error("搜索服务没有返回可用网页，请稍后重试或缩短搜索词。");
  return results;
}
