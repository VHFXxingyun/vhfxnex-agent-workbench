export type AdminUsageExportItem = {
  source: string;
  operation: "plan" | "execute";
  model: string;
  workspaceTitle: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheMeasuredInputTokens: number;
  cacheMeasuredHitTokens: number;
  latencyMs: number;
  createdAt: string;
};

export function createAdminUsageCsv(items: readonly AdminUsageExportItem[]): string;
