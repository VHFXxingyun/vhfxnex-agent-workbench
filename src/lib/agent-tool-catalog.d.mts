export type AgentToolCatalogEntry = {
  title: string;
  description: string;
  toolNames: readonly string[];
};

export const agentToolCatalog: readonly AgentToolCatalogEntry[];
