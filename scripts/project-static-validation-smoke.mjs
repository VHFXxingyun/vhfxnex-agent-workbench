import assert from "node:assert/strict";
import { toolDescriptions } from "../src/lib/agent-tools.mjs";
import { validateGeneratedProject } from "../src/lib/project-static-validation.mjs";
import {
  attachProjectReviewStatus,
  ensureProjectReviewDisclosure,
  parseProjectReview,
} from "../src/lib/project-review.mjs";

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
const reviewWarning = ensureProjectReviewDisclosure("代码项目已交付。", [
  { name: "review_project", title: "独立复核未完成" },
]);
assert.match(reviewWarning, /独立复核未完成/);
assert.equal(
  ensureProjectReviewDisclosure(reviewWarning, [
    { name: "review_project", title: "独立复核未完成" },
  ]),
  reviewWarning,
);
assert.equal(
  ensureProjectReviewDisclosure("代码项目已交付。", [
    { name: "review_project", title: "独立代码复核通过" },
  ]),
  "代码项目已交付。",
);
assert.match(toolDescriptions.create_project, /independentReview\.status.*unavailable/);

console.log(
  "✓ Project validation checks package declarations, source and asset references, Vue files, manifest structure, and independent-review outcomes.",
);
