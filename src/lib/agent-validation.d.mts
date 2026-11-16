export type InitialAgentOutput = {
  isContinuation: boolean;
  needsBudget: boolean;
  taskCount: number;
  milestoneCount: number;
  hasDocument: boolean;
  needsProject?: boolean;
  hasProject?: boolean;
  hasBudget: boolean;
  needsPdf?: boolean;
  hasPdf?: boolean;
};

export function isExecutionContinuation(input?: {
  explicitContinuation?: boolean;
  previousResult?: unknown;
}): boolean;

export function requiresDocumentDeliverable(
  input: string,
  options?: { isContinuation?: boolean },
): boolean;

export function missingInitialAgentOutputs(output: InitialAgentOutput): string[];
