import "server-only";
import database from "@/lib/db";
import type { AiRunUsage } from "@/lib/goal";

export type AiOperation = "plan" | "execute";
export type AiUsageSource = "planner" | "dialogue" | "workbench" | "reviewer" | "healthcheck";

export function recordAiUsage(
  userId: string,
  operation: AiOperation,
  usage: AiRunUsage | undefined,
  context: { workspaceId?: string; source: AiUsageSource },
) {
  if (!usage || usage.totalTokens <= 0) return;
  try {
    database
      .prepare(
        "INSERT INTO ai_usage (id, user_id, workspace_id, source, operation, model, input_tokens, cached_input_tokens, cache_measured_input_tokens, cache_measured_hit_tokens, reasoning_tokens, reasoning_measured_requests, output_tokens, total_tokens, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        crypto.randomUUID(),
        userId,
        context.workspaceId ?? null,
        context.source,
        operation,
        usage.model,
        usage.inputTokens,
        usage.cachedInputTokens ?? 0,
        usage.cacheMeasuredInputTokens ?? 0,
        usage.cacheMeasuredHitTokens ?? 0,
        usage.reasoningTokens ?? 0,
        usage.reasoningMeasuredRequests ?? 0,
        usage.outputTokens,
        usage.totalTokens,
        usage.latencyMs,
        new Date().toISOString(),
      );
  } catch {
    console.error("Unable to persist AI usage metrics.");
  }
}
