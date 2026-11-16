/**
 * Capture the durable workbench state that should change when a repair pass
 * makes progress. Tool failures alone are deliberately excluded so repeating
 * the same failed required tool does not trigger another paid model pass.
 * @param {unknown} input
 */
export function snapshotExecutionRepairProgress(input) {
  const state = input && typeof input === "object" ? input : {};
  const value = /** @type {Record<string, unknown>} */ (state);
  return JSON.stringify({
    tasks: value.tasks || [],
    milestones: value.milestones || [],
    artifacts: value.artifacts || [],
    events: Array.isArray(value.events)
      ? value.events.map((event) => {
          if (!event || typeof event !== "object") return event;
          const entry = /** @type {Record<string, unknown>} */ (event);
          return {
            name: entry.name,
            title: entry.title,
            detail: entry.detail,
            status: entry.status,
          };
        })
      : [],
    budget: value.budget ?? null,
    projectDraft: value.projectDraft ?? null,
    existingProjectFiles: value.existingProjectFiles || [],
    feasibilityReview: value.feasibilityReview ?? null,
  });
}

/**
 * Allow one additional constrained attempt when the required tool produced no
 * durable progress. This covers document and structured-file delivery too:
 * otherwise a single missed tool call can strand a completed workspace.
 * @param {{ requiredTool?: string | null; repairAttempt?: number; cancelled?: boolean }} input
 */
export function shouldRetryNoProgressRequiredToolRepair(input = {}) {
  return (
    typeof input.requiredTool === "string" &&
    input.requiredTool.length > 0 &&
    input.repairAttempt === 0 &&
    input.cancelled !== true
  );
}
