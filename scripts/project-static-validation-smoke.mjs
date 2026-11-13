import assert from "node:assert/strict";
import { validateGeneratedProject } from "../src/lib/project-static-validation.mjs";

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

console.log(
  "✓ Project validation checks package declarations, source and asset references, Vue files, and manifest structure.",
);
