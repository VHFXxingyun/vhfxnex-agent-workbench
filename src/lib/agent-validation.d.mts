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

export function missingInitialAgentOutputs(output: InitialAgentOutput): string[];
