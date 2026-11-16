export type ProjectIntent = "create" | "update" | null;

export interface ProjectIntentContext {
  isContinuation?: boolean;
  hasExistingProject?: boolean;
  mustAddTask?: boolean;
  isSoftwareWorkspace?: boolean;
  existingProjectContext?: string;
}

export function classifyProjectIntent(input: string, context?: ProjectIntentContext): ProjectIntent;
export function requestsProjectDraftRestart(input: string): boolean;
export function shouldResumeProjectDraft(context?: {
  hasDraft?: boolean;
  isContinuation?: boolean;
  isSoftwareWorkspace?: boolean;
  input?: string;
  projectIntent?: ProjectIntent;
}): boolean;
