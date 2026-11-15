import type { LanguageModelV3 } from "@ai-sdk/provider";

export type SupervisorMockScenario =
  "reply" | "handoff" | "handoff-unauthorized" | "open-user-tool" | "new-goal" | "search";

export function createSupervisorMockModel(
  scenario: SupervisorMockScenario,
  workspaceId?: string,
  directToolId?: string,
): LanguageModelV3;
