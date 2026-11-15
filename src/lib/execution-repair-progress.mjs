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
 * Allow one additional constrained attempt when code generation made no
 * durable progress. The attempt is limited to project generation because the
 * model can use the saved tool-validation feedback to correct its output.
 * Other missing-tool repairs stop immediately to avoid duplicate API spend.
 * @param {{ requiredTool?: string | null; repairAttempt?: number; cancelled?: boolean }} input
 */
export function shouldRetryNoProgressProjectRepair(input = {}) {
  return (
    input.requiredTool === "create_project" && input.repairAttempt === 0 && input.cancelled !== true
  );
}
