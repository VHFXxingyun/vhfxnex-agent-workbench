const BUDGET_LIMIT_PATTERN =
  /(?:预算|经费)(?:总额|上限)?(?:控制在|不超过|限额|为|约|是)?\s*[：:]?\s*[￥¥]?\s*(\d+(?:\.\d+)?)\s*(万|千)?\s*元?/;
const COST_LIMIT_PATTERN =
  /成本(?:上限|控制在|不超过|限额)(?:为|约|是)?\s*[：:]?\s*[￥¥]?\s*(\d+(?:\.\d+)?)\s*(万|千)?\s*元?/;
const NO_BUDGET_LIMIT_PATTERN =
  /(?:预算|经费)(?:总额)?(?:上限|限额)?\s*(?:不设|不设置|不限|不限制|无|没有)(?:总额)?\s*(?:上限|限额)?|(?:预算|经费)(?:总额)?\s*(?:不设|不设置|不限|不限制|无|没有)(?:总额)?\s*(?:上限|限额)|(?:不设|不设置|不限制|不限|取消)\s*(?:项目)?(?:总额)?(?:预算|经费)(?:总额)?(?:上限|限额)?/;

/**
 * Extract an explicitly stated overall budget limit. A line-item cost such as
 * “电子签到成本 0 元” is an estimate, not a zero-yuan project cap.
 * @param {string} prompt
 */
export function extractBudgetLimit(prompt) {
  const text = String(prompt || "");
  const match = text.match(BUDGET_LIMIT_PATTERN) || text.match(COST_LIMIT_PATTERN);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return (
    Math.round(value * (match[2] === "万" ? 10_000 : match[2] === "千" ? 1_000 : 1) * 100) / 100
  );
}

/**
 * Whether the user explicitly removed a previously saved project budget cap.
 * @param {string} instruction
 */
export function explicitlyClearsBudgetLimit(instruction) {
  return NO_BUDGET_LIMIT_PATTERN.test(String(instruction || ""));
}

/**
 * Older workspace results sometimes stored “no budget limit” as 0 with an
 * unknown status. Normalize that legacy sentinel while preserving a deliberate
 * zero limit that has a real within/over status.
 * @param {unknown} limit
 * @param {unknown} status
 */
export function normalizeLegacyBudgetLimit(limit, status) {
  return limit === 0 && status === "unknown" ? null : limit;
}
