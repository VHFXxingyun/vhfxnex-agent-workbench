/**
 * Planning data can already contain tasks and milestones before the first
 * workbench run. Only an explicit continuation flag or a saved execution
 * result makes a turn a continuation.
 * @param {{ explicitContinuation?: boolean; previousResult?: unknown }} input
 */
export function isExecutionContinuation(input = {}) {
  return input.explicitContinuation === true || input.previousResult != null;
}

/**
 * Require a fresh document artifact on a continuation only when the current
 * instruction explicitly asks to produce, revise, or deliver one.
 * @param {string} input
 * @param {{ isContinuation?: boolean }} [options]
 */
export function requiresDocumentDeliverable(input, { isContinuation = false } = {}) {
  if (!isContinuation) return true;
  return /(?:生成|制作|输出|交付|导出|下载|写入|更新|修订|改写|按.{0,4}模板|使用.{0,4}模板|完成|重做).{0,32}(?:\.docx|docx|word|文档|策划书|方案书|计划书|报告|提案)|(?:\.docx|docx|word|文档|策划书|方案书|计划书|报告|提案).{0,32}(?:生成|制作|输出|交付|导出|下载|写入|更新|修订|改写|完成|可下载)/i.test(
    String(input || ""),
  );
}

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
