import "server-only";
import database from "@/lib/db";
import type { AiRunUsage } from "@/lib/goal";

export type AiOperation = "plan" | "execute";

export function recordAiUsage(userId: string, operation: AiOperation, usage?: AiRunUsage) {
  if (!usage || usage.totalTokens <= 0) return;
  try {
    database
      .prepare(
        "INSERT INTO ai_usage (id, user_id, operation, model, input_tokens, cached_input_tokens, output_tokens, total_tokens, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        crypto.randomUUID(),
        userId,
        operation,
        usage.model,
        usage.inputTokens,
        usage.cachedInputTokens ?? 0,
        usage.outputTokens,
        usage.totalTokens,
        usage.latencyMs,
        new Date().toISOString(),
      );
  } catch {
    console.error("Unable to persist AI usage metrics.");
  }
}
