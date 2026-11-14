import { projectFileRequirements } from "./agent-tools.mjs";
import { mergeProjectBatch } from "./project-batch.mjs";
import { validateGeneratedProject } from "./project-static-validation.mjs";

function makeDraft(batch, title, description) {
  return {
    mode: batch.mode,
    title,
    description,
    files: batch.draftFiles,
    ...(batch.deleteFiles.length ? { deleteFiles: batch.deleteFiles } : {}),
  };
}

/**
 * Apply and validate one generated project batch without mutating workspace state.
 * @param {{args: {name:string;description:string;mode?:string;complete?:boolean;files:unknown[];deleteFiles?:unknown[]}; draft: unknown; existingFiles: {path:string;content:string}[]; existingTitle?:string; existingDescription?:string}} input
 */
export function prepareProjectDeliveryBatch(input) {
  const { args } = input;
  const updatedFiles = args.files.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const file = /** @type {Record<string, unknown>} */ (raw);
    if (typeof file.path !== "string" || typeof file.content !== "string") return [];
    return [{ path: file.path, content: file.content }];
  });
  const removedPaths = Array.isArray(args.deleteFiles) ? args.deleteFiles : [];
  const mode = typeof args.mode === "string" ? args.mode : "full";
  const batch = mergeProjectBatch({
    mode,
    complete: args.complete !== false,
    draft: input.draft,
    existingFiles: input.existingFiles,
    files: updatedFiles,
    deleteFiles: removedPaths,
    name: mode === "patch" ? input.existingTitle || args.name : args.name,
    description:
      mode === "patch" ? input.existingDescription || args.description : args.description,
  });
  if ("error" in batch) return { status: "error", error: batch.error };

  const title = (batch.title || args.name).trim().slice(0, 80);
  const description = (batch.description || args.description).trim().slice(0, 400);
  const draft = makeDraft(batch, title, description);

  if (!batch.complete) {
    return {
      status: "staged",
      draft,
      mode: batch.mode,
      files: batch.files,
      changedFiles: updatedFiles.map((file) => file.path),
      totalCharacters: batch.files.reduce((total, file) => total + file.content.length, 0),
    };
  }

  const requirements = projectFileRequirements(batch.files);
  if (requirements.length) return { status: "rejected", draft, error: requirements.join(" ") };

  const issues = validateGeneratedProject(batch.files);
  if (issues.length) {
    return {
      status: "rejected",
      draft,
      error: `生成代码未通过静态检查，请修复后重新提交：${issues.join("；")}`,
    };
  }

  return {
    status: "complete",
    mode: batch.mode,
    title,
    description,
    files: batch.files,
    changedFiles: updatedFiles.map((file) => file.path),
    removedFiles: removedPaths,
  };
}
