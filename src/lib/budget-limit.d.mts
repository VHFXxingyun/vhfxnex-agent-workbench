export function extractBudgetLimit(prompt: string): number | null;
export function explicitlyClearsBudgetLimit(instruction: string): boolean;
export function normalizeLegacyBudgetLimit(limit: unknown, status: unknown): unknown;
