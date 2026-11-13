import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cacheDir = path.join(process.cwd(), "data", "models");
const modelDir = path.join(cacheDir, "Xenova", "bge-small-zh-v1.5");
const requiredFiles = [
  "config.json",
  "tokenizer.json",
  path.join("onnx", "model_quantized.onnx"),
];
const missingFiles = requiredFiles.filter((file) => !fs.existsSync(path.join(modelDir, file)));

if (missingFiles.length) {
  console.log(
    "Knowledge embedding smoke skipped: the local BGE model is not cached. No model download was attempted.",
  );
  process.exit(0);
}

const { env } = await import("@huggingface/transformers");
env.cacheDir = cacheDir;
env.allowRemoteModels = false;

const {
  cosineSimilarity,
  embedKnowledgeTexts,
  MIN_KNOWLEDGE_SEMANTIC_SCORE,
} = await import(
  "../src/lib/knowledge-embeddings-core.mjs"
);
const vectors = await embedKnowledgeTexts([
  "学生证补办指南\n学生证丢失后如何申请补办？需要准备身份证、遗失说明和补办申请表。",
  "学生证补办流程\n学生证补办需要哪些材料，丢失证明和个人身份证明是必须的吗？",
  "React useEffect 指南\n如何使用 useEffect 管理组件副作用以及清理函数？",
  "校园活动场地信息\n学院阶梯教室配有固定投影和扩音设备，适合组织本科生参加的学术报告与技术工作坊。",
  "我想给大学生做一场关于人工智能行业的线下介绍，需要有投影的场地；预计 40 人，预算控制在 800 元以内，并安排一份 3 小时的现场议程。",
  "人工智能行业分享会\n面向本科生，邀请企业嘉宾介绍岗位和职业发展。",
]);

assert.equal(vectors.length, 6, "each Chinese query must produce an embedding");
assert.ok(vectors.every((vector) => vector.length >= 32 && vector.every(Number.isFinite)));
const relatedScore = cosineSimilarity(vectors[0], vectors[1]);
const unrelatedScore = cosineSimilarity(vectors[0], vectors[2]);
const eventRecallScore = cosineSimilarity(vectors[3], vectors[4]);
const eventUnrelatedScore = cosineSimilarity(vectors[0], vectors[4]);
const topicRecallScore = cosineSimilarity(vectors[5], vectors[4]);
assert.ok(
  relatedScore > unrelatedScore,
  `the local model must rank semantically related Chinese text higher (${relatedScore} vs ${unrelatedScore})`,
);
assert.ok(
  eventRecallScore >= MIN_KNOWLEDGE_SEMANTIC_SCORE,
  `a paraphrased venue query must clear the calibrated semantic retrieval threshold (${eventRecallScore} < ${MIN_KNOWLEDGE_SEMANTIC_SCORE})`,
);
assert.ok(
  topicRecallScore >= MIN_KNOWLEDGE_SEMANTIC_SCORE,
  `a related event topic must clear the calibrated semantic retrieval threshold (${topicRecallScore} < ${MIN_KNOWLEDGE_SEMANTIC_SCORE})`,
);
assert.ok(
  eventUnrelatedScore < MIN_KNOWLEDGE_SEMANTIC_SCORE,
  `unrelated student-card content must remain below the event query threshold (${eventUnrelatedScore} >= ${MIN_KNOWLEDGE_SEMANTIC_SCORE})`,
);

console.log(
  `✓ Local Chinese embedding produced ${vectors[0].length}-dimensional vectors; related text ranked higher (${relatedScore.toFixed(3)} > ${unrelatedScore.toFixed(3)}), venue recall scored ${eventRecallScore.toFixed(3)}, event-topic recall scored ${topicRecallScore.toFixed(3)}, unrelated event-query content scored ${eventUnrelatedScore.toFixed(3)} below threshold ${MIN_KNOWLEDGE_SEMANTIC_SCORE}. Remote model downloads were disabled.`,
);
