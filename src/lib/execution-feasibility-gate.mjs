/**
 * Return the event index of the latest plan document created in this execution
 * turn, or -1 when the turn has not created one.
 * @param {Array<{ name: string }>} events
 */
export function latestDraftDocumentEventIndex(events) {
  return events.reduce(
    (latest, event, index) => (event.name === "draft_document" ? index : latest),
    -1,
  );
}

/**
 * Decide which deterministic feasibility step is still required before an
 * execution may complete. A valid review is current only if it happened after
 * the latest plan document revision.
 * @param {{ required: boolean, review: { valid: boolean, eventIndex: number } | null, latestDocumentIndex: number }} state
 * @returns {"validate_feasibility" | "draft_document" | null}
 */
export function nextExecutionFeasibilityTool({ required, review, latestDocumentIndex }) {
  if (!required) return null;
  const reviewIsCurrent = Boolean(review && review.eventIndex > latestDocumentIndex);
  if (reviewIsCurrent && review?.valid) return null;
  if (reviewIsCurrent && review && !review.valid) return "draft_document";
  return "validate_feasibility";
}
