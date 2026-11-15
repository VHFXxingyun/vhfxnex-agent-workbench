export const EXECUTION_PROMPT_STABLE_PREFIX: string;

export declare function buildExecutionCheckpointMessage(input: {
  textAttachments?: Array<{ name: string; mimeType: string; content: string }>;
  images?: Array<{ name: string; mimeType: string; content: string }>;
  checkpoint: Record<string, unknown>;
}): import("ai").ModelMessage;

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
  searchPolicy: "optional" | "required" | "disabled";
}): string;
