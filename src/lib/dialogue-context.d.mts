type DialogueTask = {
  title: string;
  detail: string;
  phase: string;
  status: "pending" | "done";
};

type DialogueArtifact = {
  title: string;
  type: string;
  description: string;
  files?: Array<{ path: string }>;
};

type DialogueWorkspace = {
  prompt: string;
  selectedRouteId: string;
  plan: {
    title: string;
    category: string;
    summary: string;
    routes: Array<{ id: string; title: string }>;
    tasks: DialogueTask[];
  };
  result: {
    tasks?: DialogueTask[];
    artifacts?: DialogueArtifact[];
    summary?: string;
  } | null;
};

export function buildDialogueWorkspaceContext(workspace: DialogueWorkspace): {
  goal: string;
  goalTruncated: boolean;
  project: { title: string; type: string; summary: string; selectedRoute: string };
  tasks: DialogueTask[];
  taskProgress: { completed: number; total: number; omitted: number };
  recentDeliverables: Array<{
    title: string;
    type: string;
    description: string;
    fileCount: number;
    fileNames: string[];
    omittedFileNames: number;
  }>;
  omittedDeliverables: number;
  lastExecutionSummary: string;
};
