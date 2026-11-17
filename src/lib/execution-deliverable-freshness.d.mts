export function hasFreshExecutionEvent(
  events: ReadonlyArray<{ id: string; name: string; status?: string }>,
  name: string,
  previousEventIds: ReadonlySet<string>,
): boolean;
