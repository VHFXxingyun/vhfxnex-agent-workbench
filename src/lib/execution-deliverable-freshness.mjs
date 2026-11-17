/**
 * Check whether a required tool completed during the current execution turn.
 * Persisted events are not evidence that this turn created a fresh artifact.
 * @param {Array<{ id: string; name: string; status?: string }>} events
 * @param {string} name
 * @param {ReadonlySet<string>} previousEventIds
 */
export function hasFreshExecutionEvent(events, name, previousEventIds) {
  return events.some(
    (event) => event?.name === name && event.status === "done" && !previousEventIds.has(event.id),
  );
}
