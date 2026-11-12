export const BUDGET_AMOUNT_LIMIT = 1_000_000_000_000;
const BUDGET_ITEM_LIMIT = 15;

export function normalizeBudgetItems(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: "预算项不能为空，请提供至少一项费用。" };
  }
  if (value.length > BUDGET_ITEM_LIMIT) {
    return { error: `预算草案最多包含 ${BUDGET_ITEM_LIMIT} 项费用，请合并相近项目后重试。` };
  }

  const items = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { error: "预算项格式无效，请为每项费用提供名称和金额。" };
    }
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const amount = raw.amount;
    if (!name || typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
      return { error: "预算项格式无效，名称不能为空，金额必须为非负数。" };
    }
    if (amount > BUDGET_AMOUNT_LIMIT) {
      return { error: "单项预算金额不能超过 1 万亿元，请检查金额单位。" };
    }
    const roundedAmount = Math.round(amount * 100) / 100;
    if (!Number.isFinite(roundedAmount)) {
      return { error: "预算金额超出可计算范围，请检查金额单位。" };
    }
    items.push({ name: name.slice(0, 80), amount: roundedAmount });
  }

  const total = items.reduce((sum, item) => sum + item.amount, 0);
  if (!Number.isFinite(total) || total > BUDGET_AMOUNT_LIMIT) {
    return { error: "预算合计超出可计算范围，请调整金额或检查单位。" };
  }
  return { items, total };
}
