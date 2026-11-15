export type CapabilityCatalogItem = { name: string; description: string };
export type UserDirectToolId =
  "documents" | "pdf" | "code" | "spreadsheet" | "presentation" | "json" | "search";

export const userDirectToolCatalog: readonly (CapabilityCatalogItem & { id: UserDirectToolId })[];
export const userDirectToolIds: readonly [
  "documents",
  "pdf",
  "code",
  "spreadsheet",
  "presentation",
  "json",
  "search",
];
export const specialistAgentCatalog: readonly CapabilityCatalogItem[];
export function buildCapabilityCatalogAnswer(message: string): string | null;
