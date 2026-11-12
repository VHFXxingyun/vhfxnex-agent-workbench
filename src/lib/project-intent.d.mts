export type ProjectIntent = "create" | "update" | null;

export interface ProjectIntentContext {
  isContinuation?: boolean;
  hasExistingProject?: boolean;
  mustAddTask?: boolean;
  isSoftwareWorkspace?: boolean;
}

export function classifyProjectIntent(input: string, context?: ProjectIntentContext): ProjectIntent;
