export function buildWorkbenchHandoffResultMessage(input) {
  const outcome = input.outcome || "completed";
  const artifactLine = input.artifactTitles.length
    ? `${outcome === "completed" ? "已生成成果" : "当前可查看成果"}：${input.artifactTitles.slice(0, 8).join("、")}。`
    : outcome === "completed"
      ? "执行结果已保存到工作区。"
      : "工作区已保留此前保存的内容。";
  const progressLine =
    input.totalTasks > 0
      ? `当前项目任务进度：完成 ${input.completedTasks}/${input.totalTasks} 项。`
      : typeof input.completedToolCalls === "number"
        ? `本轮已完成 ${input.completedToolCalls} 项工具操作。`
        : "";
  const statusLine =
    outcome === "completed"
      ? `工作台已完成「${input.workspaceTitle}」这一轮执行。`
      : outcome === "cancelled"
        ? `已停止「${input.workspaceTitle}」的执行。`
        : outcome === "failed"
          ? `「${input.workspaceTitle}」执行失败，系统已停止自动重试。`
          : `「${input.workspaceTitle}」这一轮执行暂未完成。`;
  return [
    statusLine,
    input.summary,
    progressLine,
    artifactLine,
    outcome === "completed"
      ? "可以从这条消息打开工作区查看或下载成果。"
      : outcome === "failed"
        ? "可以从这条消息打开工作区查看错误并修正后重试。"
        : "可以从这条消息打开工作区查看当前状态并继续推进。",
  ]
    .filter(Boolean)
    .join("\n\n");
}
