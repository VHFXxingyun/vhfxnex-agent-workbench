export type WorkbenchHandoffResultMessageInput = {
  workspaceTitle: string;
  outcome?: "completed" | "interrupted" | "cancelled" | "failed";
  summary: string;
  completedTasks: number;
  totalTasks: number;
  completedToolCalls?: number;
  artifactTitles: string[];
};

export function buildWorkbenchHandoffResultMessage(
  input: WorkbenchHandoffResultMessageInput,
): string;
