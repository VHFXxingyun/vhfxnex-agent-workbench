export const MIN_KNOWLEDGE_SEMANTIC_SCORE: number;
export const KNOWLEDGE_EMBEDDING_VERSION: string;
export function embedKnowledgeTexts(texts: string[]): Promise<number[][]>;
export function cosineSimilarity(left: number[], right: number[]): number;
