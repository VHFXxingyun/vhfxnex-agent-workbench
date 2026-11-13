import type { KnowledgeSource } from "@/lib/goal";

export declare function fuseKnowledgeSources(
  semanticSources: KnowledgeSource[],
  keywordSources: KnowledgeSource[],
  limit?: number,
): KnowledgeSource[];
