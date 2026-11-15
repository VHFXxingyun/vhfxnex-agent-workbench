export const WORKBENCH_MAX_ATTEMPTS: 3;

export function classifyWorkbenchFailure(input?: {
  status?: number;
  error?: unknown;
  cancelled?: boolean;
}): {
  retryable: boolean;
  retryAfterMs: number;
  maxAttempts?: number;
  outcome: "retry" | "failed" | "cancelled";
};
