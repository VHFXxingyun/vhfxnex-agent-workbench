function cleanDetail(value, maximumLength = 500) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximumLength)
    : "";
}

/**
 * Explain an incomplete code-project turn without implying that a saved
 * project disappeared when the run was only trying to update it.
 * @param {{ intent?: string | null; existingProjectTitle?: string; hasExistingProject?: boolean; draftFileCount?: number; toolFailure?: string }} input
 */
export function describeIncompleteCodeProjectFailure(input = {}) {
  const projectTitle = cleanDetail(input.existingProjectTitle, 120) || "现有项目";
  const draftFileCount = Number.isInteger(input.draftFileCount)
    ? Math.max(0, input.draftFileCount)
    : 0;
  const failure = cleanDetail(input.toolFailure);

  if (input.hasExistingProject && input.intent === "update") {
    const draft = draftFileCount
      ? `已暂存 ${draftFileCount} 个文件改动，但尚未通过最终校验。`
      : "本轮改动尚未通过最终校验。";
    const detail = failure ? `最近一次代码校验反馈：${failure}。` : "";
    return `本轮未能完成现有代码项目更新。旧版本「${projectTitle}」仍可下载；${draft}${detail}可以继续推进未完成的批次并修复校验问题。`;
  }

  if (draftFileCount) {
    const detail = failure ? `最近一次代码校验反馈：${failure}。` : "";
    if (input.hasExistingProject)
      return `本轮未能完成代码项目处理。旧版本「${projectTitle}」仍可下载；已暂存 ${draftFileCount} 个文件改动，但尚未形成新的可下载版本。${detail}可以继续推进未完成的批次并修复校验问题。`;
    return `代码项目仍在分批生成：已暂存 ${draftFileCount} 个文件，但尚未形成可下载项目。${detail}已保存的阶段成果与草稿仍保留，可以继续推进。`;
  }

  if (input.hasExistingProject) {
    const detail = failure ? `最近一次代码校验反馈：${failure}。` : "";
    return `本轮未能生成新的可下载代码项目。工作区原有版本「${projectTitle}」仍可下载。${detail}可以继续推进未完成的批次并修复校验问题。`;
  }

  if (failure)
    return `代码项目生成校验未通过：${failure}。已保存的其他阶段成果仍保留。请继续当前批次，按校验反馈修复后完成交付。`;

  return "Agent 尚未生成可下载的代码项目。已有草稿会保留；请继续当前批次并完成校验与交付。";
}
