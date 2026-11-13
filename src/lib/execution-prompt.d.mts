export const EXECUTION_PROMPT_STABLE_PREFIX: string;

export declare function buildExecutionSystemPrompt(options: {
  isContinuation: boolean;
  projectInstructions?: string;
  needsSpreadsheet?: boolean;
  needsPresentation?: boolean;
  needsPdf?: boolean;
  searchPolicy: "optional" | "required" | "disabled";
}): string;
