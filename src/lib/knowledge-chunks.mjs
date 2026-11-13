const DEFAULT_SEMANTIC_CHUNK_BUDGET = 600;

function evenlySpacedIndexes(total, selected) {
  if (selected <= 0 || total <= 0) return [];
  if (selected >= total) return Array.from({ length: total }, (_, index) => index);
  if (selected === 1) return [0];
  return Array.from({ length: selected }, (_, index) =>
    Math.round((index * (total - 1)) / (selected - 1)),
  );
}

/**
 * Choose semantic chunks across a knowledge base with a fixed inference budget.
 * Small knowledge bases index every chunk; large ones distribute the budget
 * evenly across documents and sample from the full document range.
 */
export function selectKnowledgeChunkIndexes(
  chunkCounts,
  budget = DEFAULT_SEMANTIC_CHUNK_BUDGET,
) {
  const counts = Array.isArray(chunkCounts)
    ? chunkCounts.map((count) =>
        Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0,
      )
    : [];
  const maximum = Number.isFinite(budget) ? Math.max(0, Math.trunc(budget)) : 0;
  const allocations = counts.map(() => 0);
  let remaining = Math.min(maximum, counts.reduce((sum, count) => sum + count, 0));

  while (remaining > 0) {
    let allocated = false;
    for (let index = 0; index < counts.length && remaining > 0; index += 1) {
      if (allocations[index] >= counts[index]) continue;
      allocations[index] += 1;
      remaining -= 1;
      allocated = true;
    }
    if (!allocated) break;
  }

  return counts.map((total, index) =>
    evenlySpacedIndexes(total, allocations[index]),
  );
}
