export interface SearchIntent {
  requiresSearch: boolean;
  explicitlyDisabled: boolean;
}

export function classifySearchIntent(input: string): SearchIntent;
