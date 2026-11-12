import "server-only";
import database, { type DbKnowledge } from "@/lib/db";
import type { KnowledgeSource } from "@/lib/goal";

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

export function retrieve(userId: string, query: string, limit = 3): KnowledgeSource[] {
  const docs = database
    .prepare(
      "SELECT * FROM knowledge_documents WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
    )
    .all(userId) as DbKnowledge[];
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
    });
    if (selected.length >= limit) break;
  }
  return selected;
}
