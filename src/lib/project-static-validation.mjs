import path from "node:path";
import { builtinModules } from "node:module";
import ts from "typescript";
import { normalizeProjectPath, projectPathKey } from "./project-path.mjs";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const MARKUP_EXTENSIONS = new Set([".html", ".htm", ".vue", ".svelte", ".astro"]);
const IMPORT_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".scss",
  ".vue",
  ".svelte",
  ".astro",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".ico",
  ".avif",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
];
const BUILTIN_MODULES = new Set(builtinModules);
const SCRIPT_EXECUTABLE_PACKAGES = new Map([
  ["astro", "astro"],
  ["concurrently", "concurrently"],
  ["cross-env", "cross-env"],
  ["electron", "electron"],
  ["eslint", "eslint"],
  ["next", "next"],
  ["nodemon", "nodemon"],
  ["nuxt", "nuxt"],
  ["parcel", "parcel"],
  ["playwright", "playwright"],
  ["prettier", "prettier"],
  ["rollup", "rollup"],
  ["svelte-kit", "@sveltejs/kit"],
  ["tailwindcss", "tailwindcss"],
  ["tsc", "typescript"],
  ["tsx", "tsx"],
  ["vite", "vite"],
  ["vitest", "vitest"],
  ["webpack", "webpack"],
]);

function scriptKind(filePath) {
  const extension = path.posix.extname(filePath).toLowerCase();
  return extension === ".tsx" || extension === ".jsx"
    ? ts.ScriptKind.TSX
    : extension === ".js" || extension === ".mjs" || extension === ".cjs"
      ? ts.ScriptKind.JSX
      : ts.ScriptKind.TS;
}

function lineMessage(filePath, source, diagnostic) {
  const position =
    diagnostic.start === undefined
      ? undefined
      : source.getLineAndCharacterOfPosition(diagnostic.start);
  const location = position ? `:${position.line + 1}:${position.character + 1}` : "";
  return `${filePath}${location}：${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
}

function localImportExists(importPath, importer, fileKeys) {
  const cleanImportPath = importPath.split(/[?#]/, 1)[0];
  const basePath = path.posix.normalize(
    path.posix.join(path.posix.dirname(importer), cleanImportPath),
  );
  return (
    IMPORT_EXTENSIONS.some((extension) =>
      fileKeys.has(projectPathKey(`${basePath}${extension}`)),
    ) ||
    IMPORT_EXTENSIONS.some((extension) =>
      fileKeys.has(projectPathKey(`${basePath}/index${extension}`)),
    )
  );
}

function localAssetExists(assetPath, importer, fileKeys) {
  const cleanAssetPath = assetPath.split(/[?#]/, 1)[0];
  if (!cleanAssetPath || /^(?:data:|https?:|\/\/|blob:|#)/i.test(cleanAssetPath)) return true;
  if (/^(?:@|~|var\()/i.test(cleanAssetPath)) return true;
  const hasFileLikePath = path.posix.extname(cleanAssetPath) || cleanAssetPath.includes("/");
  if (!cleanAssetPath.startsWith(".") && !cleanAssetPath.startsWith("/") && !hasFileLikePath) {
    return true;
  }

  const bases = cleanAssetPath.startsWith("/")
    ? [
        path.posix.normalize(cleanAssetPath.slice(1)),
        path.posix.normalize(`public/${cleanAssetPath.slice(1)}`),
      ]
    : [path.posix.normalize(path.posix.join(path.posix.dirname(importer), cleanAssetPath))];
  return bases.some((basePath) =>
    IMPORT_EXTENSIONS.some((extension) => fileKeys.has(projectPathKey(`${basePath}${extension}`))),
  );
}

function cssAssetReferences(content) {
  const references = [];
  for (const match of content.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?/gi)) {
    references.push(match[1]);
  }
  for (const match of content.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    references.push(match[2].trim());
  }
  return Array.from(new Set(references));
}

function markupAssetReferences(content) {
  const references = [];
  for (const match of content.matchAll(/<(script|img|source|video|audio|link)\b[^>]*>/gi)) {
    const tag = match[0];
    const tagName = match[1].toLowerCase();
    const attrName = tagName === "video" ? "poster" : tagName === "link" ? "href" : "src";
    if (
      tagName === "link" &&
      !/\brel\s*=\s*["'][^"']*(?:stylesheet|icon|manifest|preload)[^"']*["']/i.test(tag)
    ) {
      continue;
    }
    const attribute = new RegExp(`\\b${attrName}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(tag);
    if (attribute) references.push(attribute[2]);
  }
  return references;
}

function packageNameForImport(request) {
  if (
    request.startsWith(".") ||
    request.startsWith("/") ||
    request.startsWith("node:") ||
    request.startsWith("@/") ||
    request.startsWith("~/") ||
    request.startsWith("#") ||
    request.startsWith("virtual:") ||
    /^(?:https?:|data:|file:)/i.test(request)
  ) {
    return null;
  }
  const rootName = request.startsWith("@")
    ? request.split("/").slice(0, 2).join("/")
    : request.split("/")[0];
  if (!rootName) return null;
  const builtinName = rootName.replace(/^node:/, "");
  return BUILTIN_MODULES.has(request) || BUILTIN_MODULES.has(builtinName) ? null : rootName;
}

function packageNamesForScripts(scripts) {
  const packages = new Set();
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return packages;
  for (const command of Object.values(scripts || {})) {
    if (typeof command !== "string") continue;
    for (const rawSegment of command.split(/&&|\|\||[;|]/)) {
      let segment = rawSegment.trim().replace(/^(?:set\s+)?(?:[A-Z_][A-Z0-9_]*=[^\s]+\s+)+/i, "");
      segment = segment.replace(
        /^(?:npx|npm\s+exec|pnpm\s+(?:exec|dlx)|yarn\s+dlx)\s+(?:--[^\s]+\s+)*/,
        "",
      );
      if (/^(?:cross-env|cross-env-shell)\s+/i.test(segment)) {
        packages.add("cross-env");
        segment = segment.replace(/^(?:cross-env|cross-env-shell)\s+/, "");
        segment = segment.replace(/^(?:[A-Z_][A-Z0-9_]*=[^\s]+\s+)+/i, "");
      }
      const executable = segment.split(/\s+/, 1)[0]?.split(/[\\/]/).at(-1)?.toLowerCase();
      const packageName = SCRIPT_EXECUTABLE_PACKAGES.get(executable);
      if (packageName) packages.add(packageName);
    }
  }
  return packages;
}

/** Parse generated source without evaluating it; the source stays inert on the server.
 * @param {{ path: string; content: string }[]} files
 */
export function validateGeneratedProject(files) {
  const errors = [];
  const normalized = files.flatMap((file) => {
    const filePath = normalizeProjectPath(file.path);
    return filePath ? [{ filePath, content: file.content }] : [];
  });
  const fileKeys = new Set(normalized.map(({ filePath }) => projectPathKey(filePath)));
  const sourceFiles = normalized.filter(({ filePath }) =>
    SOURCE_EXTENSIONS.has(path.posix.extname(filePath).toLowerCase()),
  );
  const styleFiles = normalized.filter(({ filePath }) =>
    [".css", ".scss", ".sass", ".less"].includes(path.posix.extname(filePath).toLowerCase()),
  );
  const markupFiles = normalized.filter(({ filePath }) =>
    MARKUP_EXTENSIONS.has(path.posix.extname(filePath).toLowerCase()),
  );
  const importedPackages = new Map();

  for (const file of sourceFiles) {
    const source = ts.createSourceFile(
      file.filePath,
      file.content,
      ts.ScriptTarget.Latest,
      true,
      scriptKind(file.filePath),
    );
    const diagnostics = source.parseDiagnostics;
    for (const diagnostic of diagnostics.slice(0, 5)) {
      errors.push(lineMessage(file.filePath, source, diagnostic));
      if (errors.length >= 12) return errors;
    }
    for (const imported of ts.preProcessFile(file.content, true, true).importedFiles) {
      const request = imported.fileName;
      if (request.startsWith(".") && !localImportExists(request, file.filePath, fileKeys)) {
        errors.push(`${file.filePath}：找不到本地引用「${request}」，请补充文件或修正引用。`);
      }
      const packageName = packageNameForImport(request);
      if (packageName) {
        const importers = importedPackages.get(packageName) || [];
        importers.push(file.filePath);
        importedPackages.set(packageName, importers);
      }
      if (errors.length >= 12) return errors;
    }
  }

  for (const file of [...styleFiles, ...markupFiles]) {
    const references = styleFiles.includes(file)
      ? cssAssetReferences(file.content)
      : markupAssetReferences(file.content);
    for (const reference of references) {
      if (!localAssetExists(reference, file.filePath, fileKeys)) {
        errors.push(`${file.filePath}：找不到本地资源「${reference}」，请补充文件或修正引用。`);
      }
      if (errors.length >= 12) return errors;
    }
  }

  const packageFile = normalized.find(
    ({ filePath }) => projectPathKey(filePath) === projectPathKey("package.json"),
  );
  if (packageFile) {
    try {
      const manifest = JSON.parse(packageFile.content);
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        errors.push("package.json：根内容必须是 JSON 对象。");
      } else {
        const scripts = manifest.scripts;
        if (
          scripts !== undefined &&
          (!scripts || typeof scripts !== "object" || Array.isArray(scripts))
        ) {
          errors.push("package.json：scripts 必须是 JSON 对象。");
        } else if (
          scripts &&
          Object.entries(scripts).some(
            ([name, command]) => !name.trim() || typeof command !== "string" || !command.trim(),
          )
        ) {
          errors.push("package.json：每个 scripts 命令都必须是非空名称和字符串。");
        }
        const declaredPackages = new Set();
        for (const field of [
          "dependencies",
          "devDependencies",
          "optionalDependencies",
          "peerDependencies",
        ]) {
          const entries = manifest[field];
          if (entries === undefined) continue;
          if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
            errors.push(`package.json：${field} 必须是 JSON 对象。`);
            continue;
          }
          for (const [name, version] of Object.entries(entries)) {
            if (!name.trim() || typeof version !== "string" || !version.trim()) {
              errors.push(`package.json：${field} 中每个依赖都要有名称和版本。`);
            } else {
              declaredPackages.add(name);
            }
          }
        }
        for (const packageName of packageNamesForScripts(scripts)) {
          if (!declaredPackages.has(packageName)) {
            errors.push(
              `package.json：scripts 使用了「${packageName}」命令，但依赖清单没有声明该包。`,
            );
          }
        }
        for (const [name, importers] of importedPackages) {
          if (!declaredPackages.has(name)) {
            errors.push(`${importers[0]}：使用了「${name}」，但 package.json 没有声明该依赖。`);
          }
        }
      }
    } catch (error) {
      errors.push(
        `package.json：JSON 格式错误（${error instanceof Error ? error.message.slice(0, 140) : "无法解析"}）。`,
      );
    }
  } else if (importedPackages.size > 0) {
    const [name, importers] = importedPackages.entries().next().value;
    errors.push(`${importers[0]}：使用了「${name}」，但项目缺少 package.json 依赖清单。`);
  }
  return errors.slice(0, 12);
}
