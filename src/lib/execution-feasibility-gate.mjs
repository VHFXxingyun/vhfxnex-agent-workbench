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
 * Restore the latest explicit feasibility result from persisted tool events
 * when a failed execution is resumed. Unknown/legacy event titles remain
 * unverified instead of being treated as a pass.
 * @param {Array<{ name: string; title?: string; status?: string }>} events
 * @returns {{ valid: boolean; eventIndex: number } | null}
 */
export function latestExecutionFeasibilityReview(events) {
  let latest = null;
  events.forEach((event, eventIndex) => {
    if (event?.name !== "validate_feasibility" || event.status !== "done") return;
    if (event.title === "可行性检查发现冲突") latest = { valid: false, eventIndex };
    else if (event.title === "执行约束已核对" || event.title === "部分约束待确认")
      latest = { valid: true, eventIndex };
  });
  return latest;
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

/**
 * A missing or stale review is not evidence of a conflict. Permit delivery of
 * complete work as explicitly unverified, while still blocking a current,
 * concrete negative review.
 * @param {{ deliverablesComplete: boolean, review: { valid: boolean, eventIndex: number } | null, latestDocumentIndex: number }} state
 */
export function canDeliverWithUnverifiedFeasibility({
  deliverablesComplete,
  review,
  latestDocumentIndex,
}) {
  if (!deliverablesComplete) return false;
  const reviewIsCurrent = Boolean(review && review.eventIndex > latestDocumentIndex);
  return !(reviewIsCurrent && review && !review.valid);
}

/**
 * Explain why the feasibility gate is still open without treating a missing
 * review result as proof that the plan contains a conflict.
 * @param {{ required: boolean, review: { valid: boolean, eventIndex: number } | null, latestDocumentIndex: number, failures?: Array<{ detail?: string }> }} state
 */
export function describeExecutionFeasibilityFailure({
  required,
  review,
  latestDocumentIndex,
  failures = [],
}) {
  const nextTool = nextExecutionFeasibilityTool({ required, review, latestDocumentIndex });
  if (!nextTool) return null;

  const latestFailure = [...failures].reverse().find((failure) => failure?.detail)?.detail;
  const failureDetail =
    typeof latestFailure === "string" && latestFailure.trim()
      ? `工具返回的信息：${latestFailure.trim().slice(0, 500)}`
      : "";

  if (review && review.eventIndex > latestDocumentIndex && !review.valid) {
    return `可行性复核发现尚未解决的冲突，方案未完成修订。${failureDetail}`.trim();
  }

  if (review && review.eventIndex <= latestDocumentIndex) {
    return review.valid
      ? "方案在上次通过复核后又有修改；最新版本尚未重新复核，不能标为完成。"
      : `上次复核发现冲突，但之后的方案修改尚未通过重新复核。${failureDetail}`.trim();
  }

  return `本轮未取得可行性复核结果；这不代表系统已判定方案存在冲突。方案已保留为未核验结果。${failureDetail}`.trim();
}
