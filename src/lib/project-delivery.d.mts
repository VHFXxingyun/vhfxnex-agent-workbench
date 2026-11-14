import type { ProjectDraft } from "./goal";

export type ProjectDeliveryInput = {
  args: {
    name: string;
    description: string;
    mode?: string;
    complete?: boolean;
    files: unknown[];
    deleteFiles?: unknown[];
  };
  draft: ProjectDraft | null;
  existingFiles: { path: string; content: string }[];
  existingTitle?: string;
  existingDescription?: string;
};

export function prepareProjectDeliveryBatch(input: ProjectDeliveryInput):
  | { status: "error"; error: string }
  | {
      status: "staged";
      draft: ProjectDraft;
      mode: "full" | "patch";
      files: { path: string; content: string }[];
      changedFiles: string[];
      totalCharacters: number;
    }
  | { status: "rejected"; draft: ProjectDraft; error: string }
  | {
      status: "complete";
      mode: "full" | "patch";
      title: string;
      description: string;
      files: { path: string; content: string }[];
      changedFiles: string[];
      removedFiles: unknown[];
    };
