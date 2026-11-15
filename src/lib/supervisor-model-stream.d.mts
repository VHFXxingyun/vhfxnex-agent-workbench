import type { ZodType } from "zod";

type Handoff = { instruction: string; workspaceId?: string };
type UserToolLaunch = {
  tool: "documents" | "pdf" | "code" | "spreadsheet" | "json" | "presentation" | "search";
  instruction: string;
};
type NewGoalLaunch = { prompt: string };

export function consumeSupervisorModelStream(args: {
  fullStream: AsyncIterable<{ type: string; [key: string]: unknown }>;
  signal: AbortSignal;
  isCancelled: () => boolean;
  send: (event: unknown) => boolean;
  schemas: {
    handoff: ZodType<Handoff>;
    userTool: ZodType<UserToolLaunch>;
    newGoal: ZodType<NewGoalLaunch>;
  };
}): Promise<{
  answer: string;
  handoff: Handoff | null;
  userToolLaunch: UserToolLaunch | null;
  newGoalLaunch: NewGoalLaunch | null;
}>;
