/**
 * Draft plans describe work to be done. Keep completed-looking checklist marks out
 * of those artifacts unless a future tool can prove that an action was performed.
 * Fenced code examples are preserved verbatim.
 *
 * @param {string} markdown
 */
export function markPlanChecklistItemsPending(markdown) {
  let activeFence = "";
  return String(markdown || "")
    .split(/\r?\n/)
    .map((line) => {
      const fence = line.match(/^\s*(`{3,}|~{3,})/);
      if (fence) {
        const marker = fence[1];
        if (!activeFence) activeFence = marker;
        else if (marker[0] === activeFence[0] && marker.length >= activeFence.length)
          activeFence = "";
        return line;
      }
      if (activeFence) return line;
      return line.replace(/^(\s*(?:[-+*]|\d+[.)])\s+)\[[xX]\](?=\s|$)/, "$1[ ]");
    })
    .join("\n");
}
