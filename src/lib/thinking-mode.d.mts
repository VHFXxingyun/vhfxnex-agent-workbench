export const DEFAULT_THINKING_MODE: "deep";
export function normalizeThinkingMode(value: unknown): "fast" | "deep";
export function deepSeekThinkingOptions(mode: "fast" | "deep"):
  | { thinking: { type: "disabled" } }
  | { thinking: { type: "enabled" }; reasoning_effort: "high" };
