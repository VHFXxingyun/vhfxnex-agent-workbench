const SEARCH_REQUEST_PATTERN =
  /联网|网页搜索|网络搜索|网上搜|搜索|查一下|查一查|查找|找资料|最新|现行|官网|来源|verify|web search|search online|look up|latest|current rules/i;

const NEGATIVE_SEARCH_PATTERNS = [
  /(?:不要|不需要|无需|不用|不必|别|禁止)(?:再|为我|在|到|去)?(?:联网|互联网|上网|网上|网络|网页)?(?:去|进行)?(?:搜索|搜|查询|查找|查资料|找资料)/gi,
  /(?:不要|不需要|无需|不用|不必|别|禁止)(?:再|在|到|去)?(?:联网|互联网|上网|网上|网络|网页)/gi,
  /(?:do not|don't|dont|no need to|without|no)\s+(?:(?:search|browse|look up)(?:\s+(?:the\s+)?(?:web|internet|online))?|go online)/gi,
];

const SCOPED_NEGATIVE_SEARCH_PATTERN =
  /(?:不要|不需要|无需|不用|不必|别|禁止)(?:再|为我|在|到|去)?(?:联网|互联网|上网|网上|网络|网页)?(?:去|进行)?(?:搜索|搜|查询|查找|查资料|找资料|browse|search|look up)\s*(?:论坛|贴吧|知乎|微博|抖音|小红书|B站|豆瓣|公众号|社交媒体|社区|博客|新闻网站|官方(?:网站|文档|公告|页面|来源)?|官网|政府网站|学校官网|企业官网|第三方网站|[\w.-]+\.(?:com|cn|org|gov|edu)(?:\/[^\s，,。；;]*)?)/gi;

const CONTRAST_PATTERN = /但(?:是)?|不过|改为|还是|而是|but|however/i;
const SOURCE_ONLY_PATTERN =
  /(?:只|仅)(?:根据|依据|按照|按|使用|用|参考|查看|看|基于|依靠).{0,20}(?:我给|我提供|我上传|我发|附件|材料|文档|这段内容|上述内容|当前对话|已有信息|现有信息)/gi;

function withoutScopedExclusions(text) {
  return text.replace(SCOPED_NEGATIVE_SEARCH_PATTERN, " ");
}

function getNegativeSearches(text) {
  return NEGATIVE_SEARCH_PATTERNS.flatMap((pattern) => [...text.matchAll(pattern)]).sort(
    (left, right) => (left.index || 0) - (right.index || 0),
  );
}

function hasSearchRequest(text) {
  return SEARCH_REQUEST_PATTERN.test(text);
}

/**
 * Classifies whether a request requires live web search and whether the user
 * explicitly prohibited it for this turn.
 */
export function classifySearchIntent(input) {
  const scopedText = withoutScopedExclusions(String(input || ""));
  const optOuts = [
    ...getNegativeSearches(scopedText),
    ...[...scopedText.matchAll(SOURCE_ONLY_PATTERN)],
  ].sort((left, right) => (left.index || 0) - (right.index || 0));

  if (optOuts.length) {
    const lastOptOut = optOuts.at(-1);
    const remainder = scopedText.slice((lastOptOut?.index || 0) + (lastOptOut?.[0].length || 0));
    const contrast = CONTRAST_PATTERN.exec(remainder);

    if (contrast) {
      const explicitOverride = remainder.slice(contrast.index + contrast[0].length);
      if (hasSearchRequest(explicitOverride)) {
        return { requiresSearch: true, explicitlyDisabled: false };
      }
    }

    return { requiresSearch: false, explicitlyDisabled: true };
  }

  return {
    requiresSearch: hasSearchRequest(scopedText),
    explicitlyDisabled: false,
  };
}
