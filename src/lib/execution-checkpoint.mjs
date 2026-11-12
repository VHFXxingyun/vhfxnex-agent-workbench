/**
 * Merge the latest tool output into the last durable workspace result.
 * Events are deduplicated because a checkpoint contains the current run's
 * complete event list, while the previous result already contains earlier
 * checkpoints from that same run.
 *
 * @param {import("./goal").ExecutionResult | null | undefined} previous
 * @param {import("./goal").ExecutionResult} current
 * @param {string} summary
 * @param {number} eventLimit
 * @param {number} artifactLimit
 * @returns {import("./goal").ExecutionResult}
 */
export function mergeExecutionCheckpoint(
  previous,
  current,
  summary,
  eventLimit = 100,
  artifactLimit = 100,
) {
  const eventById = new Map();
  for (const event of [...(previous?.events || []), ...current.events]) {
    if (event && typeof event.id === "string") eventById.set(event.id, event);
  }

  return {
    summary: summary.slice(0, 3000),
    tasks: current.tasks,
    milestones: current.milestones.length ? current.milestones : previous?.milestones || [],
    artifacts: [
      ...(previous?.artifacts || []).filter(
        (saved) => !current.artifacts.some((updated) => updated.type === saved.type),
      ),
      ...current.artifacts,
    ].slice(-Math.max(0, artifactLimit)),
    events: [...eventById.values()].slice(-Math.max(0, eventLimit)),
    ...(current.usage || previous?.usage ? { usage: current.usage || previous?.usage } : {}),
    ...(current.budget !== undefined
      ? { budget: current.budget }
      : previous?.budget !== undefined
        ? { budget: previous.budget }
        : {}),
  };
}
