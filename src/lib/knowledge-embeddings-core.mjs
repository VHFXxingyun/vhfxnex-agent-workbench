import path from "node:path";

const MODEL_ID = "Xenova/bge-small-zh-v1.5";
export const KNOWLEDGE_EMBEDDING_VERSION = `${MODEL_ID}:plain-text-v2`;

// BGE-small Chinese similarities cluster below the old 0.72 cutoff for
// useful paraphrases. Keep this conservative floor grounded by offline smoke
// examples while allowing keyword ranking to further ground the final result.
export const MIN_KNOWLEDGE_SEMANTIC_SCORE = 0.56;

async function loadPipeline() {
  const { env, pipeline } = await import("@huggingface/transformers");
  env.cacheDir = path.join(process.cwd(), "data", "models");
  return pipeline("feature-extraction", MODEL_ID, { dtype: "q8" });
}

let pipelinePromise = null;

async function getPipeline() {
  if (!pipelinePromise) {
    pipelinePromise = loadPipeline().catch((error) => {
      pipelinePromise = null;
      throw error;
    });
  }
  return pipelinePromise;
}

/** @param {string[]} texts */
export async function embedKnowledgeTexts(texts) {
  if (!texts.length) return [];
  const extractor = await getPipeline();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  const vectors = output.tolist();
  if (
    vectors.length !== texts.length ||
    vectors.some(
      (vector) =>
        !Array.isArray(vector) ||
        vector.length < 32 ||
        vector.some((value) => !Number.isFinite(value)),
    )
  )
    throw new Error("本地语义模型返回了无效向量。");
  return vectors;
}

/** @param {number[]} left @param {number[]} right */
export function cosineSimilarity(left, right) {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  const denominator = Math.sqrt(leftNorm * rightNorm);
  return denominator ? dot / denominator : 0;
}
