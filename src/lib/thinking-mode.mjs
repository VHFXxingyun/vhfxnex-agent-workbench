export const DEFAULT_THINKING_MODE = "deep";

/** @param {unknown} value */
export function normalizeThinkingMode(value) {
  return value === "fast" ? "fast" : DEFAULT_THINKING_MODE;
}

/** @param {"fast" | "deep"} mode */
export function deepSeekThinkingOptions(mode) {
  return mode === "fast"
    ? { thinking: { type: "disabled" } }
    : { thinking: { type: "enabled" }, reasoning_effort: "high" };
}
