export function normalizeProjectPath(value: unknown): string | null;

export function projectPathKey(value: string): string;

export function mergeProjectFilePatch(
  existingFiles: { path: string; content: string }[],
  updatedFiles: { path: string; content: string }[],
  removedPaths?: string[],
): { path: string; content: string }[];
