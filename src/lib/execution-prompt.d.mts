export const EXECUTION_PROMPT_STABLE_PREFIX: string;

export declare function buildExecutionCheckpointMessage(input: {
  textAttachments?: Array<{ name: string; mimeType: string; content: string }>;
  images?: Array<{ name: string; mimeType: string; content: string }>;
  checkpoint: Record<string, unknown>;
}): import("ai").ModelMessage;

export declare function buildExecutionProjectFileContext(input: {
  existingProjectFiles?: Array<{ path: string; content: string }>;
  projectDraft?: {
    files?: Array<{ path: string; content: string }>;
    deleteFiles?: string[];
  } | null;
}): {
  existingProjectFiles: Array<{ path: string; content: string }>;
  stagedProjectFiles: Array<{ path: string; content: string }>;
  stagedProjectDeletes: string[];
};

export declare function buildExecutionRecentUserInstructions(
  conversation: Array<{ role: string; content: string }>,
  currentTurnContent?: string[],
): string[];

export declare function buildExecutionSystemPrompt(options: {
  isContinuation: boolean;
  projectInstructions?: string;
  needsSpreadsheet?: boolean;
  needsPresentation?: boolean;
  needsPdf?: boolean;
  sourceTemplateAvailable?: boolean;
  searchPolicy: "optional" | "required" | "disabled";
}): string;
