export type WorkspaceProgressTask = { title: string; status: string };
export type WorkspaceProgressArtifact = { title: string };
export type WorkspaceProgressContext = {
  executionIsRunning: boolean;
  executionWasInterrupted: boolean;
  currentActivity?: string;
  completedToolCalls?: number;
  globalExecution?: { workspaceTitle: string; activity: string } | null;
  latestExecutionMessage?: string;
  latestExecutionActivity?: string;
  latestExecutionState?: "running" | "completed" | "failed";
  resultSummary?: string | null;
  tasks?: WorkspaceProgressTask[];
  artifacts?: WorkspaceProgressArtifact[];
};

export function isWorkspaceProgressQuestion(question: string): boolean;
export function buildWorkspaceProgressAnswer(context: WorkspaceProgressContext): string;
