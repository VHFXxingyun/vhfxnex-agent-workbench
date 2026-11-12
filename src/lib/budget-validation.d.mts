export const BUDGET_AMOUNT_LIMIT: number;

export type BudgetItem = { name: string; amount: number };

export type BudgetNormalization =
  | { items: BudgetItem[]; total: number; error?: never }
  | { error: string; items?: never; total?: never };

export function normalizeBudgetItems(value: unknown): BudgetNormalization;
