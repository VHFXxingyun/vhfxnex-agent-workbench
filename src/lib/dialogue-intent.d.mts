export declare function classifyExplicitUserToolLaunch(message: string): {
  tool: "documents" | "pdf" | "code" | "spreadsheet" | "json" | "presentation" | "search";
  instruction: string;
} | null;

export declare function classifyExplicitNewGoalLaunch(message: string): { prompt: string } | null;

export declare function classifyExplicitWorkbenchExecution(
  message: string,
): { instruction: string } | null;
