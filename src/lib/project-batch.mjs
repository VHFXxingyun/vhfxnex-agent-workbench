import { mergeProjectFilePatch, normalizeProjectPath, projectPathKey } from "./project-path.mjs";

export const PROJECT_BATCH_LIMITS = Object.freeze({
  batchFiles: 20,
  batchCharacters: 45_000,
  files: 60,
  characters: 100_000,
  bytes: 100_000,
  fileCharacters: 45_000,
});

function sizeError(files, label) {
  if (files.length > PROJECT_BATCH_LIMITS.files)
    return `${label}最多保留 ${PROJECT_BATCH_LIMITS.files} 个文件。`;
  if (files.some((file) => file.content.length > PROJECT_BATCH_LIMITS.fileCharacters))
    return `单个项目文件不能超过 ${PROJECT_BATCH_LIMITS.fileCharacters} 个字符。`;
  if (
    files.reduce((total, file) => total + file.content.length, 0) > PROJECT_BATCH_LIMITS.characters
  )
    return `项目源码不能超过 ${PROJECT_BATCH_LIMITS.characters} 个字符。`;
  if (
    files.reduce((total, file) => total + new TextEncoder().encode(file.content).byteLength, 0) >
    PROJECT_BATCH_LIMITS.bytes
  )
    return `项目源码 UTF-8 大小不能超过 ${PROJECT_BATCH_LIMITS.bytes} 字节。`;
  return null;
}

/** @param {unknown} value */
export function isValidProjectDraft(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value.mode !== "full" && value.mode !== "patch") ||
    typeof value.title !== "string" ||
    !value.title.length ||
    value.title.length > 80 ||
    typeof value.description !== "string" ||
    !value.description.length ||
    value.description.length > 400 ||
    !Array.isArray(value.files) ||
    value.files.length === 0 ||
    value.files.length > PROJECT_BATCH_LIMITS.files
  )
    return false;

  const files = value.files;
  if (
    !files.every(
      (file) =>
        file &&
        typeof file === "object" &&
        typeof file.path === "string" &&
        file.path.length <= 120 &&
        normalizeProjectPath(file.path) !== null &&
        typeof file.content === "string" &&
        file.content.length <= PROJECT_BATCH_LIMITS.fileCharacters,
    )
  )
    return false;

  const deleteFiles = value.deleteFiles;
  if (
    deleteFiles !== undefined &&
    (!Array.isArray(deleteFiles) ||
      (value.mode !== "patch" && deleteFiles.length > 0) ||
      deleteFiles.length > 20 ||
      !deleteFiles.every(
        (filePath) =>
          typeof filePath === "string" &&
          filePath.length <= 120 &&
          normalizeProjectPath(filePath) !== null,
      ) ||
      new Set(deleteFiles.map(projectPathKey)).size !== deleteFiles.length ||
      deleteFiles.some((filePath) =>
        files.some((file) => projectPathKey(file.path) === projectPathKey(filePath)),
      ))
  )
    return false;

  return (
    !sizeError(files, "项目") &&
    new Set(files.map((file) => projectPathKey(file.path))).size === files.length &&
    files.reduce((total, file) => total + file.content.length, 0) <= PROJECT_BATCH_LIMITS.characters
  );
}

/**
 * Merge one model output batch into a full project or a patch draft.
 * Patch drafts keep only changed files, avoiding a duplicate copy of the
 * existing project in the persisted workspace. The original project is
 * merged only when the final batch is ready for validation and download.
 * @param {{mode?: string; complete?: boolean; draft?: {mode: "full"|"patch"; title: string; description: string; files: {path:string;content:string}[]; deleteFiles?:string[]}|null; existingFiles: {path:string;content:string}[]; files: {path:string;content:string}[]; deleteFiles?: string[]; name: string; description: string}} input
 */
export function mergeProjectBatch(input) {
  const mode = input.mode || "full";
  const complete = input.complete !== false;
  const draft = input.draft || null;

  if (mode === "append" && !draft) return { error: "没有待续写的代码批次。" };
  if (mode !== "append" && draft) return { error: "已有未完成的代码批次，请使用 append 继续。" };
  if (mode === "patch" && input.existingFiles.length === 0)
    return { error: "找不到可修改的现有项目，请先生成代码项目。" };
  if (mode === "append" && (input.deleteFiles || []).length > 0)
    return { error: "append 批次不能删除文件；请在 patch 初始批次中指定删除项。" };
  if (input.files.length > PROJECT_BATCH_LIMITS.batchFiles)
    return { error: `单批最多提交 ${PROJECT_BATCH_LIMITS.batchFiles} 个文件。` };
  if (
    input.files.reduce((total, file) => total + file.content.length, 0) >
    PROJECT_BATCH_LIMITS.batchCharacters
  )
    return { error: `单批源码不能超过 ${PROJECT_BATCH_LIMITS.batchCharacters} 个字符。` };
  if (!complete && input.files.length === 0)
    return { error: "未完成的代码批次至少要包含一个文件。" };

  const rootMode = draft?.mode || (mode === "patch" ? "patch" : "full");
  const draftFiles =
    mode === "append"
      ? mergeProjectFilePatch(draft?.files || [], input.files)
      : rootMode === "patch"
        ? mergeProjectFilePatch([], input.files)
        : input.files;
  const deleteFiles = draft?.deleteFiles || input.deleteFiles || [];
  const finalFiles =
    rootMode === "patch"
      ? mergeProjectFilePatch(input.existingFiles, draftFiles, deleteFiles)
      : draftFiles;
  const error = sizeError(finalFiles, "项目");
  if (error) return { error };

  return {
    complete,
    mode: rootMode,
    draftFiles,
    files: complete ? finalFiles : draftFiles,
    deleteFiles,
    title: draft?.title || input.name,
    description: draft?.description || input.description,
  };
}
