export function missingInitialAgentOutputs(output) {
  if (output.isContinuation) return [];

  const missing = [];
  if (output.taskCount === 0) missing.push("任务");
  if (output.milestoneCount === 0) missing.push("时间线");
  if (!output.hasDocument) missing.push("行动方案");
  if (output.needsProject && !output.hasProject) missing.push("可运行代码项目");
  if (output.needsBudget && !output.hasBudget) missing.push("预算核算");
  if (output.needsPdf && !output.hasPdf) missing.push("PDF 文件");
  return missing;
}
