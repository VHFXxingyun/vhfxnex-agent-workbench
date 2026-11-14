export type ExecutionFeasibilityReview = { valid: boolean; eventIndex: number } | null;
export type ExecutionFeasibilityTool = "validate_feasibility" | "draft_document" | null;

export function latestDraftDocumentEventIndex(events: Array<{ name: string }>): number;

export function nextExecutionFeasibilityTool(state: {
  required: boolean;
  review: ExecutionFeasibilityReview;
  latestDocumentIndex: number;
}): ExecutionFeasibilityTool;
