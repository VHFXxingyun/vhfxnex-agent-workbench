export function snapshotExecutionRepairProgress(state: unknown): string;
export function shouldRetryNoProgressProjectRepair(input?: {
  requiredTool?: string | null;
  repairAttempt?: number;
  cancelled?: boolean;
}): boolean;
