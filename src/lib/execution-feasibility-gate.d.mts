export type ExecutionFeasibilityReview = { valid: boolean; eventIndex: number } | null;
export type ExecutionFeasibilityTool = "validate_feasibility" | "draft_document" | null;

export function latestDraftDocumentEventIndex(events: Array<{ name: string }>): number;
export function latestExecutionFeasibilityReview(
  events: Array<{ name: string; title?: string; status?: string }>,
): ExecutionFeasibilityReview;

export function describeExecutionFeasibilityFailure(state: {
  required: boolean;
  review: ExecutionFeasibilityReview;
  latestDocumentIndex: number;
  failures?: Array<{ detail?: string }>;
}): string | null;

export function nextExecutionFeasibilityTool(state: {
  required: boolean;
  review: ExecutionFeasibilityReview;
  latestDocumentIndex: number;
}): ExecutionFeasibilityTool;

export function canDeliverWithUnverifiedFeasibility(state: {
  deliverablesComplete: boolean;
  review: ExecutionFeasibilityReview;
  latestDocumentIndex: number;
}): boolean;
