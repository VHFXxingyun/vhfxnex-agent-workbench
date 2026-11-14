const MAX_GOAL_CHARS = 4_000;
const MAX_SUMMARY_CHARS = 600;
const MAX_TASKS = 10;
const MAX_COMPLETED_TASKS = 2;
const MAX_ARTIFACTS = 5;

function compactText(value, limit) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1).trimEnd()}…`;
}

/** Build a bounded dialogue-only summary; the workbench still reads full server state. */
export function buildDialogueWorkspaceContext(workspace) {
  const allTasks = workspace.result?.tasks || workspace.plan.tasks || [];
  const pendingTasks = allTasks.filter((task) => task.status !== "done");
  const completedTasks = allTasks.filter((task) => task.status === "done");
  const includedTasks = [
    ...pendingTasks.slice(0, MAX_TASKS),
    ...completedTasks.slice(-MAX_COMPLETED_TASKS),
  ];
  const artifacts = workspace.result?.artifacts || [];
  const recentArtifacts = artifacts.slice(-MAX_ARTIFACTS);
  const route = workspace.plan.routes.find((item) => item.id === workspace.selectedRouteId);

  return {
    goal: compactText(workspace.prompt, MAX_GOAL_CHARS),
    goalTruncated: workspace.prompt.length > MAX_GOAL_CHARS,
    project: {
      title: compactText(workspace.plan.title, 120),
      type: compactText(workspace.plan.category, 80),
      summary: compactText(workspace.plan.summary, MAX_SUMMARY_CHARS),
      selectedRoute: compactText(route?.title || "未选择", 120),
    },
    tasks: includedTasks.map(({ title, detail, phase, status }) => ({
      title: compactText(title, 120),
      detail: compactText(detail, 220),
      phase: compactText(phase, 80),
      status,
    })),
    taskProgress: {
      completed: completedTasks.length,
      total: allTasks.length,
      omitted: allTasks.length - includedTasks.length,
    },
    recentDeliverables: recentArtifacts.map(({ title, type, description, files }) => ({
      title: compactText(title, 120),
      type,
      description: compactText(description, 180),
      fileCount: files?.length || 0,
      fileNames:
        files
          ?.slice(0, 4)
          .map((file) => compactText(file.path.split(/[\\/]/).pop() || file.path, 120)) || [],
      omittedFileNames: Math.max(0, (files?.length || 0) - 4),
    })),
    omittedDeliverables: artifacts.length - recentArtifacts.length,
    lastExecutionSummary: compactText(
      workspace.result?.summary || "本轮执行尚未完成。",
      MAX_SUMMARY_CHARS,
    ),
  };
}
