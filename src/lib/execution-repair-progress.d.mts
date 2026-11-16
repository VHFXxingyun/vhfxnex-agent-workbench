export function snapshotExecutionRepairProgress(state: unknown): string;
export function shouldRetryNoProgressRequiredToolRepair(input?: {
  requiredTool?: string | null;
  repairAttempt?: number;
  cancelled?: boolean;
}): boolean;
