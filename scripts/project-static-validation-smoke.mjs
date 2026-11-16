import assert from "node:assert/strict";
import {
  parseToolArguments,
  projectFileRequirements,
  toolDescriptions,
} from "../src/lib/agent-tools.mjs";
import { validateGeneratedProject } from "../src/lib/project-static-validation.mjs";
import {
  isValidProjectDraft,
  mergeProjectBatch,
  PROJECT_BATCH_LIMITS,
} from "../src/lib/project-batch.mjs";
import { prepareProjectDeliveryBatch } from "../src/lib/project-delivery.mjs";
import {
  isExecutionContinuation,
  missingInitialAgentOutputs,
} from "../src/lib/agent-validation.mjs";
import { mergeExecutionCheckpoint } from "../src/lib/execution-checkpoint.mjs";
import {
  latestExecutionFeasibilityReview,
  nextExecutionFeasibilityTool,
} from "../src/lib/execution-feasibility-gate.mjs";
import {
  shouldRetryNoProgressRequiredToolRepair,
  snapshotExecutionRepairProgress,
} from "../src/lib/execution-repair-progress.mjs";
import {
  attachProjectReviewStatus,
  finalizeExecutionSummary,
  parseProjectReview,
} from "../src/lib/project-review.mjs";
import { classifyProjectIntent } from "../src/lib/project-intent.mjs";
import { shouldResumeProjectDraft } from "../src/lib/project-intent.mjs";
import { requiresDocumentDeliverable } from "../src/lib/agent-validation.mjs";

const projectWithDeclaredDependencies = [
  {
    path: "package.json",
    content: JSON.stringify({
      dependencies: { react: "^19.0.0" },
      devDependencies: { vite: "^7.0.0", "cross-env": "^7.0.0" },
      scripts: { dev: "cross-env NODE_ENV=development vite --host" },
    }),
  },
  {
    path: "src/main.ts",
    content:
      'import React from "react"; import "./theme.css?inline"; import Widget from "./Widget.vue"; import { readFile } from "node:fs/promises"; void React; void Widget; void readFile;',
  },
  {
    path: "src/theme.css",
    content:
      '@import "./tokens.css"; body { background: url("../public/grid.svg"); } .badge { background: url("images/badge.svg"); }',
  },
  { path: "src/tokens.css", content: ":root { --surface: #111; }" },
  { path: "public/grid.svg", content: "<svg />" },
  { path: "src/images/badge.svg", content: "<svg />" },
  { path: "src/Widget.vue", content: "<template><div>Ready</div></template>" },
  {
    path: "index.html",
    content:
      '<img src="/grid.svg" /><img src="assets/logo.svg" /><script type="module" src="./src/main.ts"></script>',
  },
  { path: "assets/logo.svg", content: "<svg />" },
];

assert.deepEqual(validateGeneratedProject(projectWithDeclaredDependencies), []);

const firstRunIsContinuation = isExecutionContinuation({
  explicitContinuation: false,
  previousResult: null,
});
assert.equal(firstRunIsContinuation, false);
assert.deepEqual(
  missingInitialAgentOutputs({
    isContinuation: firstRunIsContinuation,
    needsBudget: false,
    taskCount: 2,
    milestoneCount: 3,
    hasDocument: false,
    hasBudget: false,
  }),
  ["行动方案"],
);
assert.equal(
  isExecutionContinuation({ explicitContinuation: false, previousResult: { tasks: [] } }),
  true,
);

assert.equal(
  classifyProjectIntent("做一份桌面番茄钟小工具吧", {
    isContinuation: true,
    hasExistingProject: true,
    existingProjectContext: "做一个桌面计时器\n桌面计时器开发计划",
  }),
  "update",
);
assert.equal(
  classifyProjectIntent("做一个桌面宠物小工具", {
    isContinuation: true,
    hasExistingProject: true,
    existingProjectContext: "做一个桌面计时器\n桌面计时器开发计划",
  }),
  "create",
);
assert.equal(
  classifyProjectIntent(
    "立即继续完成消防活动策划，并交付模板 DOCX；不要把文档任务转成 Python/DOCX 工具链代码项目。",
    { isContinuation: true, hasExistingProject: false, isSoftwareWorkspace: false },
  ),
  null,
);
assert.equal(
  classifyProjectIntent("不要创建代码项目，只需要完成并交付这份 DOCX 文档。", {
    isContinuation: true,
    hasExistingProject: false,
    isSoftwareWorkspace: true,
  }),
  null,
);
assert.equal(
  shouldResumeProjectDraft({
    hasDraft: true,
    isContinuation: true,
    isSoftwareWorkspace: false,
    input: "继续完成消防活动策划并交付 DOCX",
  }),
  false,
);
assert.equal(
  shouldResumeProjectDraft({
    hasDraft: true,
    isContinuation: true,
    isSoftwareWorkspace: true,
    input: "继续",
  }),
  true,
);
assert.equal(
  shouldResumeProjectDraft({
    hasDraft: true,
    isContinuation: true,
    isSoftwareWorkspace: true,
    input: "解释一下 API 命中率",
  }),
  false,
);
assert.equal(
  requiresDocumentDeliverable("最终交付可下载的 DOCX，并按模板保留标题和样式", {
    isContinuation: true,
  }),
  true,
);
assert.equal(
  requiresDocumentDeliverable("做到哪里了？", { isContinuation: true }),
  false,
);
const repairProgressFixture = {
  tasks: [{ id: "task-1", title: "实现计时逻辑", status: "pending" }],
  milestones: [],
  artifacts: [],
  events: [],
  budget: null,
  projectDraft: null,
  existingProjectFiles: [],
  feasibilityReview: null,
  toolFailures: [{ name: "create_project", detail: "调用失败" }],
};
const noProgressSnapshot = snapshotExecutionRepairProgress(repairProgressFixture);
assert.equal(snapshotExecutionRepairProgress(repairProgressFixture), noProgressSnapshot);
assert.equal(
  snapshotExecutionRepairProgress({
    ...repairProgressFixture,
    toolFailures: [{ name: "create_project", detail: "相同工具再次失败" }],
  }),
  noProgressSnapshot,
);
assert.notEqual(
  snapshotExecutionRepairProgress({
    ...repairProgressFixture,
    events: [
      { name: "create_project", title: "代码已生成", detail: "新增 1 个文件", status: "done" },
    ],
  }),
  noProgressSnapshot,
);
assert.equal(
  shouldRetryNoProgressRequiredToolRepair({ requiredTool: "create_project", repairAttempt: 0 }),
  true,
);
assert.equal(
  shouldRetryNoProgressRequiredToolRepair({ requiredTool: "create_project", repairAttempt: 1 }),
  false,
);
assert.equal(
  shouldRetryNoProgressRequiredToolRepair({
    requiredTool: "create_project",
    repairAttempt: 0,
  }),
  true,
);
assert.equal(
  shouldRetryNoProgressRequiredToolRepair({ requiredTool: "draft_document", repairAttempt: 0 }),
  true,
);
const resumedReview = latestExecutionFeasibilityReview([
  { name: "draft_document", title: "方案已起草", status: "done" },
  { name: "validate_feasibility", title: "可行性检查发现冲突", status: "done" },
]);
assert.deepEqual(resumedReview, { valid: false, eventIndex: 1 });
assert.equal(
  nextExecutionFeasibilityTool({
    required: true,
    review: resumedReview,
    latestDocumentIndex: 2,
  }),
  "validate_feasibility",
);

const firstProjectBatch = mergeProjectBatch({
  mode: "full",
  complete: false,
  draft: null,
  existingFiles: [],
  files: [{ path: "README.md", content: "启动：直接打开 index.html。" }],
  name: "批量项目",
  description: "项目说明",
});
assert.equal(firstProjectBatch.complete, false);
assert.equal(firstProjectBatch.files.length, 1);
assert.equal(isValidProjectDraft(firstProjectBatch), true);
const completedProjectBatch = mergeProjectBatch({
  mode: "append",
  complete: true,
  draft: firstProjectBatch,
  existingFiles: [],
  files: [{ path: "index.html", content: "<!doctype html><h1>Ready</h1>" }],
  name: "批次标题不覆盖草稿标题",
  description: "批次说明",
});
assert.equal(completedProjectBatch.complete, true);
assert.equal(completedProjectBatch.title, "批量项目");
assert.deepEqual(
  completedProjectBatch.files.map((file) => file.path),
  ["README.md", "index.html"],
);
assert.deepEqual(projectFileRequirements(completedProjectBatch.files), []);

let resumableDraft = null;
const stagedReadme = prepareProjectDeliveryBatch({
  args: {
    name: "可恢复项目",
    description: "验证分批交付恢复",
    mode: "full",
    complete: false,
    files: [{ path: "README.md", content: "# 可恢复项目\n\n直接打开 index.html。" }],
  },
  draft: resumableDraft,
  existingFiles: [],
});
assert.equal(stagedReadme.status, "staged");
resumableDraft = stagedReadme.draft;
const stagedSource = prepareProjectDeliveryBatch({
  args: {
    name: "后续批次不应改名",
    description: "后续说明不覆盖原项目",
    mode: "append",
    complete: false,
    files: [{ path: "src/main.js", content: 'document.querySelector("#app");' }],
  },
  draft: resumableDraft,
  existingFiles: [],
});
assert.equal(stagedSource.status, "staged");
resumableDraft = stagedSource.draft;
const rejectedFinalBatch = prepareProjectDeliveryBatch({
  args: {
    name: "后续批次不应改名",
    description: "后续说明不覆盖原项目",
    mode: "append",
    complete: true,
    files: [{ path: "src/theme.css", content: "body { color: #222; }" }],
  },
  draft: resumableDraft,
  existingFiles: [],
});
assert.equal(rejectedFinalBatch.status, "rejected");
assert.match(rejectedFinalBatch.error, /可运行入口/);
resumableDraft = rejectedFinalBatch.draft;
const resumedCheckpoint = mergeExecutionCheckpoint(
  null,
  {
    summary: "分批项目仍在生成。",
    tasks: [],
    milestones: [],
    artifacts: [],
    events: [{ name: "create_project", title: "代码项目批次已保存" }],
    projectDraft: resumableDraft,
  },
  "分批项目仍在生成。",
);
assert.deepEqual(resumedCheckpoint.projectDraft, resumableDraft);
const completedAfterResume = prepareProjectDeliveryBatch({
  args: {
    name: "后续批次不应改名",
    description: "后续说明不覆盖原项目",
    mode: "append",
    complete: true,
    files: [
      {
        path: "index.html",
        content:
          '<!doctype html><main id="app"></main><script type="module" src="./src/main.js"></script>',
      },
    ],
  },
  draft: resumedCheckpoint.projectDraft,
  existingFiles: [],
});
assert.equal(completedAfterResume.status, "complete");
assert.equal(completedAfterResume.title, "可恢复项目");
assert.deepEqual(
  completedAfterResume.files.map((file) => file.path),
  ["README.md", "src/main.js", "src/theme.css", "index.html"],
);
assert.deepEqual(validateGeneratedProject(completedAfterResume.files), []);

const initialPatchBatch = prepareProjectDeliveryBatch({
  args: {
    name: "后续传入名称",
    description: "后续传入说明",
    mode: "patch",
    complete: false,
    files: [{ path: "index.html", content: "<!doctype html><h1>Patched</h1>" }],
    deleteFiles: ["src/obsolete.js"],
  },
  draft: null,
  existingFiles: [
    ...completedProjectBatch.files,
    { path: "src/obsolete.js", content: "export const obsolete = true;" },
  ],
  existingTitle: "原项目名称",
  existingDescription: "原项目说明",
});
assert.equal(initialPatchBatch.status, "staged");
const appendedPatchBatch = prepareProjectDeliveryBatch({
  args: {
    name: "后续名称",
    description: "后续说明",
    mode: "append",
    complete: false,
    files: [{ path: "src/added.js", content: "export const added = true;" }],
  },
  draft: initialPatchBatch.draft,
  existingFiles: [
    ...completedProjectBatch.files,
    { path: "src/obsolete.js", content: "export const obsolete = true;" },
  ],
});
assert.equal(appendedPatchBatch.status, "staged");
const completedPatchDelivery = prepareProjectDeliveryBatch({
  args: {
    name: "仍不应覆盖名称",
    description: "仍不应覆盖说明",
    mode: "append",
    complete: true,
    files: [{ path: "src/final.js", content: "export const final = true;" }],
  },
  draft: appendedPatchBatch.draft,
  existingFiles: [
    ...completedProjectBatch.files,
    { path: "src/obsolete.js", content: "export const obsolete = true;" },
  ],
  existingTitle: "原项目名称",
  existingDescription: "原项目说明",
});
assert.equal(completedPatchDelivery.status, "complete");
assert.equal(completedPatchDelivery.mode, "patch");
assert.equal(completedPatchDelivery.title, "原项目名称");
assert.equal(completedPatchDelivery.description, "原项目说明");
assert.deepEqual(completedPatchDelivery.changedFiles, [
  "index.html",
  "src/added.js",
  "src/final.js",
]);
assert.deepEqual(completedPatchDelivery.removedFiles, ["src/obsolete.js"]);
assert.equal(
  completedPatchDelivery.files.some((file) => file.path === "src/obsolete.js"),
  false,
);
assert.match(
  completedPatchDelivery.files.find((file) => file.path === "index.html")?.content || "",
  /Patched/,
);
assert.deepEqual(validateGeneratedProject(completedPatchDelivery.files), []);

const patchDraft = mergeProjectBatch({
  mode: "patch",
  complete: false,
  draft: null,
  existingFiles: completedProjectBatch.files,
  files: [{ path: "new-feature.js", content: "export const ready = true;" }],
  deleteFiles: ["index.html"],
  name: "覆盖后的标题",
  description: "覆盖后的说明",
});
assert.deepEqual(
  patchDraft.files.map((file) => file.path),
  ["new-feature.js"],
);
assert.deepEqual(patchDraft.deleteFiles, ["index.html"]);
assert.equal(isValidProjectDraft(patchDraft), true);
assert.equal(
  isValidProjectDraft({
    ...patchDraft,
    deleteFiles: ["new-feature.js"],
  }),
  false,
);
const completedPatch = mergeProjectBatch({
  mode: "append",
  complete: true,
  draft: patchDraft,
  existingFiles: completedProjectBatch.files,
  files: [{ path: "index.html", content: "<!doctype html><h1>Updated</h1>" }],
  name: "后续批次标题",
  description: "后续批次说明",
});
assert.deepEqual(
  completedPatch.files.map((file) => file.path),
  ["README.md", "new-feature.js", "index.html"],
);
assert.deepEqual(projectFileRequirements(completedPatch.files), []);
assert.match(
  mergeProjectBatch({
    mode: "append",
    draft: null,
    existingFiles: [],
    files: [],
    name: "空批次",
    description: "说明",
  }).error,
  /没有待续写/,
);
let oversizedFileDraft = mergeProjectBatch({
  mode: "full",
  complete: false,
  draft: null,
  existingFiles: [],
  files: Array.from({ length: PROJECT_BATCH_LIMITS.batchFiles }, (_, index) => ({
    path: `src/file-${index}.js`,
    content: "export {};",
  })),
  name: "文件超限",
  description: "说明",
});
let expandedProject = oversizedFileDraft;
for (let start = PROJECT_BATCH_LIMITS.batchFiles; start < 60; start += PROJECT_BATCH_LIMITS.batchFiles) {
  expandedProject = mergeProjectBatch({
    mode: "append",
    complete: false,
    draft: expandedProject,
    existingFiles: [],
    files: Array.from({ length: PROJECT_BATCH_LIMITS.batchFiles }, (_, offset) => ({
      path: `src/file-${start + offset}.js`,
      content: "export {};",
    })),
    name: "追加批次",
    description: "说明",
  });
}
expandedProject = mergeProjectBatch({
  mode: "append",
  complete: true,
  draft: expandedProject,
  existingFiles: [],
  files: [{ path: "src/file-60.js", content: "export {};" }],
  name: "超过原文件数上限",
  description: "项目文件数不应限制完整交付",
});
assert.equal(expandedProject.error, undefined);
assert.equal(expandedProject.files.length, 61);

const oversizedBatch = mergeProjectBatch({
  mode: "full",
  complete: true,
  draft: null,
  existingFiles: [],
  files: [
    { path: "src/one.js", content: "x".repeat(23_000) },
    { path: "src/two.js", content: "y".repeat(23_000) },
  ],
  name: "单批工具参数超限",
  description: "调用参数按批次交付",
});
assert.match(oversizedBatch.error, /单批源码不能超过/);

let largeProject = mergeProjectBatch({
  mode: "full",
  complete: false,
  draft: null,
  existingFiles: [],
  files: [{ path: "src/part-0.js", content: "x".repeat(40_000) }],
  name: "完整源码不设总量上限",
  description: "说明",
});
for (let index = 1; index < 3; index += 1) {
  largeProject = mergeProjectBatch({
    mode: "append",
    complete: index === 2,
    draft: largeProject,
    existingFiles: [],
    files: [{ path: `src/part-${index}.js`, content: "y".repeat(40_000) }],
    name: "追加完整源码",
    description: "说明",
  });
}
assert.equal(largeProject.error, undefined);
assert.equal(largeProject.complete, true);
assert.ok(largeProject.files.reduce((total, file) => total + file.content.length, 0) > 100_000);
assert.equal(
  parseToolArguments(
    "create_project",
    JSON.stringify({
      name: "分批项目",
      description: "草稿首批",
      mode: "full",
      complete: false,
      files: [{ path: "README.md", content: "临时说明" }],
    }),
  ).ok,
  true,
);
assert.equal(
  parseToolArguments(
    "create_project",
    JSON.stringify({
      name: "分批项目",
      description: "最终批次",
      mode: "append",
      complete: true,
      files: [],
    }),
  ).ok,
  true,
);

const validPathAlias = validateGeneratedProject([
  {
    path: "tsconfig.json",
    content: JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["src/*"] },
      },
    }),
  },
  {
    path: "src/main.ts",
    content: 'import Button from "@/components/Button"; void Button;',
  },
  { path: "src/components/Button.tsx", content: "export default function Button() {}" },
]);
assert.deepEqual(validPathAlias, []);

const validCustomPathAlias = validateGeneratedProject([
  {
    path: "jsconfig.json",
    content: JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@components/*": ["src/components/*"], "~/*": ["src/*"] },
      },
    }),
  },
  {
    path: "src/main.js",
    content:
      'import Button from "@components/Button"; import Layout from "~/layout/Layout"; void Button; void Layout;',
  },
  { path: "src/components/Button.jsx", content: "export default function Button() {}" },
  { path: "src/layout/Layout.jsx", content: "export default function Layout() {}" },
]);
assert.deepEqual(validCustomPathAlias, []);

const specificAliasOverridesBroadAlias = validateGeneratedProject([
  {
    path: "tsconfig.json",
    content: JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@/*": ["src/*"],
          "@/components/*": ["missing-components/*"],
        },
      },
    }),
  },
  {
    path: "src/main.ts",
    content: 'import Button from "@/components/Button"; void Button;',
  },
  { path: "src/components/Button.tsx", content: "export default function Button() {}" },
]);
assert.match(
  specificAliasOverridesBroadAlias.join(" "),
  /找不到路径别名引用.*@\/components\/Button/,
  "the most specific matching path alias must take precedence over a broader mapping",
);

const aliasFallbackTarget = validateGeneratedProject([
  {
    path: "tsconfig.json",
    content: JSON.stringify({
      compilerOptions: {
        paths: { "@/*": ["missing/*", "src/*"] },
      },
    }),
  },
  { path: "src/main.ts", content: 'import Button from "@/Button"; void Button;' },
  { path: "src/Button.tsx", content: "export default function Button() {}" },
]);
assert.deepEqual(aliasFallbackTarget, [], "path mapping targets must support fallback resolution");

const inheritedPathAlias = validateGeneratedProject([
  { path: "tsconfig.json", content: JSON.stringify({ extends: "./config/tsconfig.base.json" }) },
  {
    path: "config/tsconfig.base.json",
    content: JSON.stringify({ compilerOptions: { paths: { "@base/*": ["../src/*"] } } }),
  },
  {
    path: "src/main.ts",
    content: 'import Button from "@base/components/Button"; void Button;',
  },
  { path: "src/components/Button.tsx", content: "export default function Button() {}" },
]);
assert.deepEqual(inheritedPathAlias, [], "local extended config aliases must be resolved");

const inheritedPathAliasUsesOverriddenBaseUrl = validateGeneratedProject([
  {
    path: "tsconfig.json",
    content: JSON.stringify({
      extends: "./config/tsconfig.base.json",
      compilerOptions: { baseUrl: "." },
    }),
  },
  {
    path: "config/tsconfig.base.json",
    content: JSON.stringify({ compilerOptions: { paths: { "@root/*": ["src/*"] } } }),
  },
  { path: "src/main.ts", content: 'import Button from "@root/Button"; void Button;' },
  { path: "src/Button.tsx", content: "export default function Button() {}" },
]);
assert.deepEqual(
  inheritedPathAliasUsesOverriddenBaseUrl,
  [],
  "an extending config's baseUrl must be honored when resolving inherited path targets",
);

const missingInheritedPathAlias = validateGeneratedProject([
  { path: "tsconfig.json", content: JSON.stringify({ extends: "./config/tsconfig.base.json" }) },
  {
    path: "config/tsconfig.base.json",
    content: JSON.stringify({ compilerOptions: { paths: { "@base/*": ["../src/*"] } } }),
  },
  { path: "src/main.ts", content: 'import Missing from "@base/Missing"; void Missing;' },
]);
assert.match(
  missingInheritedPathAlias.join(" "),
  /找不到路径别名引用.*@base\/Missing/,
  "missing files referenced through an inherited alias must be reported",
);

const externalExtendedConfig = validateGeneratedProject([
  {
    path: "package.json",
    content: JSON.stringify({ dependencies: { next: "16.0.0" } }),
  },
  { path: "tsconfig.json", content: JSON.stringify({ extends: "next/tsconfig" }) },
  { path: "src/main.ts", content: "export {};" },
]);
assert.deepEqual(
  externalExtendedConfig,
  [],
  "package-provided configs must not be reported missing when the generated bundle omits node_modules",
);

const missingLocalExtendedConfig = validateGeneratedProject([
  { path: "tsconfig.json", content: JSON.stringify({ extends: "./config/missing.json" }) },
  { path: "src/main.ts", content: "export {};" },
]);
assert.match(missingLocalExtendedConfig.join(" "), /Cannot read file .*config\/missing\.json/);

const missingPathAlias = validateGeneratedProject([
  {
    path: "tsconfig.json",
    content: JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@/*": ["src/*"] },
      },
    }),
  },
  {
    path: "src/main.ts",
    content: 'import Button from "@/components/Missing"; void Button;',
  },
]);
assert.match(missingPathAlias.join(" "), /找不到路径别名引用.*@\/components\/Missing/);

const bundlerPathAliasWithoutTsConfig = validateGeneratedProject([
  {
    path: "src/main.ts",
    content: 'import Button from "@/components/Button"; void Button;',
  },
]);
assert.deepEqual(bundlerPathAliasWithoutTsConfig, []);

const missingNpmDependency = validateGeneratedProject([
  { path: "package.json", content: JSON.stringify({ scripts: { dev: "vite" } }) },
  { path: "src/main.ts", content: 'import React from "react"; void React;' },
]);
assert.match(missingNpmDependency.join(" "), /react.*没有声明该依赖/);
assert.match(missingNpmDependency.join(" "), /scripts 使用了「vite」命令.*没有声明该包/);

const missingManifest = validateGeneratedProject([
  { path: "src/main.ts", content: 'import React from "react"; void React;' },
]);
assert.match(missingManifest.join(" "), /缺少 package\.json 依赖清单/);

const missingVueFile = validateGeneratedProject([
  { path: "src/main.ts", content: 'import Widget from "./Widget.vue"; void Widget;' },
]);
assert.match(missingVueFile.join(" "), /找不到本地引用.*Widget\.vue/);

const invalidDependencyMap = validateGeneratedProject([
  { path: "package.json", content: JSON.stringify({ dependencies: [] }) },
]);
assert.match(invalidDependencyMap.join(" "), /dependencies 必须是 JSON 对象/);

const missingCssAssets = validateGeneratedProject([
  {
    path: "src/theme.css",
    content:
      '@import "./missing.css"; .hero { background: url("../public/missing.svg"); } .mark { background: url("images/missing-bare.svg"); }',
  },
]);
assert.match(missingCssAssets.join(" "), /找不到本地资源.*missing\.css/);
assert.match(missingCssAssets.join(" "), /找不到本地资源.*missing\.svg/);
assert.match(missingCssAssets.join(" "), /找不到本地资源.*missing-bare\.svg/);

const missingMarkupAsset = validateGeneratedProject([
  {
    path: "index.html",
    content:
      '<img src="/missing.png" /><img src="assets/missing-bare.webp" /><script src="./missing.js"></script>',
  },
]);
assert.match(missingMarkupAsset.join(" "), /找不到本地资源.*missing\.png/);
assert.match(missingMarkupAsset.join(" "), /找不到本地资源.*missing\.js/);
assert.match(missingMarkupAsset.join(" "), /找不到本地资源.*missing-bare\.webp/);

const invalidScriptCommand = validateGeneratedProject([
  { path: "package.json", content: JSON.stringify({ scripts: { dev: 42 } }) },
]);
assert.match(invalidScriptCommand.join(" "), /scripts 命令都必须是非空名称和字符串/);

assert.deepEqual(parseProjectReview('{"approved":true,"issues":[]}'), {
  approved: true,
  issues: [],
});
assert.deepEqual(parseProjectReview('```json\n{"approved":false,"issues":["入口无法启动"]}\n```'), {
  approved: false,
  issues: ["入口无法启动"],
});
for (const malformedReview of [
  "不是 JSON",
  '{"approved":true}',
  '{"approved":"true","issues":[]}',
  '{"approved":true,"issues":[1]}',
]) {
  assert.throws(() => parseProjectReview(malformedReview));
}
const reviewUnavailable = attachProjectReviewStatus(
  { created: true, files: ["README.md", "index.html"] },
  "unavailable",
  "静态检查已通过；独立复核未完成。",
);
assert.equal(reviewUnavailable.created, true);
assert.deepEqual(reviewUnavailable.files, ["README.md", "index.html"]);
assert.equal(reviewUnavailable.independentReview.status, "unavailable");
const unreviewedExecution = {
  summary: "代码项目已交付。",
  events: [{ name: "review_project", title: "独立复核未完成" }],
  artifacts: [{ type: "code", title: "示例项目" }],
};
const finalizedUnreviewedExecution = finalizeExecutionSummary(unreviewedExecution, null, "");
assert.match(finalizedUnreviewedExecution.summary, /独立复核未完成/);
assert.equal(finalizedUnreviewedExecution.events, unreviewedExecution.events);
assert.equal(finalizedUnreviewedExecution.artifacts, unreviewedExecution.artifacts);
assert.equal(
  finalizeExecutionSummary(finalizedUnreviewedExecution, null, "").summary,
  finalizedUnreviewedExecution.summary,
);
assert.equal(
  finalizeExecutionSummary(
    {
      summary: "代码项目已交付。",
      events: [{ name: "review_project", title: "独立代码复核通过" }],
    },
    null,
    "",
  ).summary,
  "代码项目已交付。",
);
assert.equal(
  finalizeExecutionSummary(
    {
      summary: "模型的详细回复。",
      events: [{ name: "review_project", title: "独立复核未完成" }],
    },
    { summary: "旧摘要" },
    "补充工作区内容",
  ).summary,
  "已根据补充指示完成 1 次工具操作，并更新相关成果。\n\n独立复核未完成（复核服务暂不可用）；项目已通过静态检查，代码未在服务器执行。",
);
assert.match(toolDescriptions.create_project, /independentReview\.status.*unavailable/);

console.log(
  "✓ Project delivery validates source/manifests, resumes rejected batches, and reports cross-batch patch changes and deletions.",
);
