import type { z } from "zod";

export const toolSchemas: Record<string, z.ZodType>;

export const toolDescriptions: Record<string, string>;

export function parseToolArguments(
  name: string,
  serialized: string,
):
  | { ok: true; args: Record<string, unknown> }
  | {
      ok: false;
      error: string;
      details?: { field: string; requirement: string }[];
    };

export function projectFileRequirements(files: { path: string; content: string }[]): string[];
