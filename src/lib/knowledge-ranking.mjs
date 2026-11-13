const RECIPROCAL_RANK_OFFSET = 20;
const SEMANTIC_WEIGHT = 0.6;
const KEYWORD_WEIGHT = 0.4;

/**
 * Fuse dense and lexical retrieval ranks without comparing incompatible score
 * scales. Semantic rank leads; exact keyword matches can lift and ground a hit.
 */
export function fuseKnowledgeSources(semanticSources, keywordSources, limit = 3) {
  const candidates = new Map();

  const addRanks = (sources, field, weight) => {
    const seen = new Set();
    for (const [index, source] of sources.entries()) {
      if (!source?.id || seen.has(source.id)) continue;
      seen.add(source.id);

      const candidate = candidates.get(source.id) || {
        semantic: null,
        keyword: null,
        fusionScore: 0,
        firstSeen: candidates.size,
      };
      candidate[field] = source;
      candidate.fusionScore += weight / (RECIPROCAL_RANK_OFFSET + index + 1);
      candidates.set(source.id, candidate);
    }
  };

  addRanks(semanticSources, "semantic", SEMANTIC_WEIGHT);
  addRanks(keywordSources, "keyword", KEYWORD_WEIGHT);

  return [...candidates.entries()]
    .sort(
      ([, left], [, right]) =>
        right.fusionScore - left.fusionScore || left.firstSeen - right.firstSeen,
    )
    .slice(0, Math.max(0, Math.trunc(limit)))
    .map(([id, candidate]) => {
      const primary = candidate.semantic || candidate.keyword;
      const lexical = candidate.keyword;
      return {
        ...primary,
        id,
        excerpt: lexical?.excerpt || candidate.semantic?.excerpt || primary.excerpt,
        score: Math.round(candidate.fusionScore * 1_000_000) / 1_000_000,
        matchType:
          candidate.semantic && candidate.keyword
            ? "hybrid"
            : candidate.semantic
              ? "semantic"
              : "keyword",
      };
    });
}
