import "server-only";
import { createHash } from "node:crypto";
import database, { type DbKnowledge } from "@/lib/db";
import type { KnowledgeSource } from "@/lib/goal";
import {
  cosineSimilarity,
  embedKnowledgeTexts,
  KNOWLEDGE_EMBEDDING_VERSION,
  MIN_KNOWLEDGE_SEMANTIC_SCORE,
} from "@/lib/knowledge-embeddings";
import { selectKnowledgeChunkIndexes } from "@/lib/knowledge-chunks.mjs";
import { fuseKnowledgeSources } from "@/lib/knowledge-ranking.mjs";

type KnowledgeChunk = { id: string; title: string; excerpt: string; index: number };
type StoredEmbedding = {
  knowledge_id: string;
  chunk_index: number;
  content_hash: string;
  excerpt: string;
  vector_json: string;
};

function grams(text: string) {
  const cleaned = text.toLowerCase().replace(/\s+/g, " ").trim();
  const latin = cleaned.match(/[a-z0-9]{2,}/g) || [];
  const han = cleaned.match(/[\p{Script=Han}]+/gu) || [];
  const parts = han.flatMap((part) =>
    part.length < 2
      ? [part]
      : Array.from({ length: part.length - 1 }, (_, i) => part.slice(i, i + 2)),
  );
  return [...latin, ...parts].filter((token) => token.length > 0);
}

function chunks(content: string) {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean);
  const result: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length > 900 && current) {
      result.push(current);
      current = "";
    }
    if (paragraph.length > 900) {
      for (let i = 0; i < paragraph.length; i += 900) result.push(paragraph.slice(i, i + 900));
    } else current += `${current ? "\n\n" : ""}${paragraph}`;
  }
  if (current) result.push(current);
  return result;
}

function semanticChunks(docs: DbKnowledge[]): KnowledgeChunk[] {
  const allByDocument = docs.map((doc) => ({
    doc,
    chunks: chunks(doc.content),
  }));
  const selectedIndexes = selectKnowledgeChunkIndexes(
    allByDocument.map((entry) => entry.chunks.length),
  );
  return allByDocument.flatMap(({ doc, chunks: documentChunks }, documentIndex) =>
    selectedIndexes[documentIndex].map((index) => ({
      id: doc.id,
      title: doc.title,
      excerpt: documentChunks[index],
      index,
    })),
  );
}

function chunkHash(chunk: KnowledgeChunk) {
  return createHash("sha256")
    .update(`${KNOWLEDGE_EMBEDDING_VERSION}\n${chunk.title}\n${chunk.excerpt}`)
    .digest("hex");
}

function lexicalSearch(docs: DbKnowledge[], query: string, limit: number): KnowledgeSource[] {
  const terms = [...new Set(grams(query))];
  if (!terms.length) return [];
  const candidates = docs.flatMap((doc) =>
    chunks(doc.content).map((excerpt, index) => ({ id: doc.id, title: doc.title, excerpt, index })),
  );
  const frequencies = new Map<string, number>();
  for (const candidate of candidates)
    for (const token of new Set(grams(candidate.excerpt + " " + candidate.title)))
      frequencies.set(token, (frequencies.get(token) || 0) + 1);
  const ranked = candidates
    .map((candidate) => {
      const tokens = grams(candidate.excerpt + " " + candidate.title);
      const counts = new Map<string, number>();
      for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
      const score =
        terms.reduce((sum, term) => {
          const tf = counts.get(term) || 0;
          if (!tf) return sum;
          const idf = Math.log(1 + (candidates.length + 1) / (1 + (frequencies.get(term) || 0)));
          return sum + idf * (1 + Math.log(tf));
        }, 0) / Math.sqrt(Math.max(tokens.length, 1));
      return { ...candidate, score };
    })
    .filter((item) => item.score > 0.15)
    .sort((a, b) => b.score - a.score);
  const selected: KnowledgeSource[] = [];
  for (const item of ranked) {
    if (selected.some((existing) => existing.id === item.id)) continue;
    selected.push({
      id: item.id,
      title: item.title,
      excerpt: item.excerpt.slice(0, 900),
      score: Math.round(item.score * 100) / 100,
      matchType: "keyword",
    });
    if (selected.length >= limit) break;
  }
  return selected;
}

function parseVector(value: string): number[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length >= 32 && parsed.every(Number.isFinite)
      ? (parsed as number[])
      : null;
  } catch {
    return null;
  }
}

async function semanticSearch(docs: DbKnowledge[], query: string, limit: number) {
  const sampled = semanticChunks(docs);
  const rows = database
    .prepare(
      "SELECT knowledge_id, chunk_index, content_hash, excerpt, vector_json FROM knowledge_embeddings WHERE user_id = ?",
    )
    .all(docs[0]?.user_id || "") as StoredEmbedding[];
  const stored = new Map(rows.map((row) => [`${row.knowledge_id}:${row.chunk_index}`, row]));
  const missing = sampled.filter((chunk) => {
    const cached = stored.get(`${chunk.id}:${chunk.index}`);
    return !cached || cached.content_hash !== chunkHash(chunk);
  });
  const now = new Date().toISOString();
  const insert = database.prepare(
    `INSERT INTO knowledge_embeddings
      (knowledge_id, user_id, chunk_index, content_hash, excerpt, vector_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(knowledge_id, chunk_index) DO UPDATE SET
       user_id = excluded.user_id, content_hash = excluded.content_hash,
       excerpt = excluded.excerpt, vector_json = excluded.vector_json,
       updated_at = excluded.updated_at`,
  );
  for (let start = 0; start < missing.length; start += 24) {
    const batch = missing.slice(start, start + 24);
    const vectors = await embedKnowledgeTexts(
      batch.map((chunk) => `${chunk.title}\n${chunk.excerpt}`),
    );
    database.transaction(() => {
      batch.forEach((chunk, index) => {
        const doc = docs.find((candidate) => candidate.id === chunk.id);
        if (!doc) return;
        const vectorJson = JSON.stringify(vectors[index]);
        insert.run(
          chunk.id,
          doc.user_id,
          chunk.index,
          chunkHash(chunk),
          chunk.excerpt,
          vectorJson,
          now,
        );
        stored.set(`${chunk.id}:${chunk.index}`, {
          knowledge_id: chunk.id,
          chunk_index: chunk.index,
          content_hash: chunkHash(chunk),
          excerpt: chunk.excerpt,
          vector_json: vectorJson,
        });
      });
    })();
  }

  const queryVector = (await embedKnowledgeTexts([query.slice(0, 1200)]))[0];
  const candidates = sampled.flatMap((chunk) => {
    const row = stored.get(`${chunk.id}:${chunk.index}`);
    const vector =
      row && row.content_hash === chunkHash(chunk) ? parseVector(row.vector_json) : null;
    return vector
      ? [
          {
            ...chunk,
            score: cosineSimilarity(queryVector, vector),
          },
        ]
      : [];
  });
  const bestByDocument = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    const current = bestByDocument.get(candidate.id);
    if (!current || current.score < candidate.score) bestByDocument.set(candidate.id, candidate);
  }
  return [...bestByDocument.values()]
    .filter((candidate) => candidate.score >= MIN_KNOWLEDGE_SEMANTIC_SCORE)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      excerpt: candidate.excerpt.slice(0, 900),
      score: Math.round(candidate.score * 100) / 100,
      matchType: "semantic" as const,
    }));
}

export async function retrieve(userId: string, query: string, limit = 3): Promise<KnowledgeSource[]> {
  const docs = database
    .prepare(
      "SELECT * FROM knowledge_documents WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
    )
    .all(userId) as DbKnowledge[];
  if (!docs.length || !grams(query).length) return [];
  const keyword = lexicalSearch(docs, query, limit);
  try {
    const semantic = await semanticSearch(docs, query, limit);
    if (semantic.length) return fuseKnowledgeSources(semantic, keyword, limit);
  } catch {
    // Local embedding is optional at runtime; retain useful keyword search when offline.
  }
  return keyword;
}
