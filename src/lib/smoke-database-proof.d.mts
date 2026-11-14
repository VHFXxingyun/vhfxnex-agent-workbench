export function createSmokeDatabaseProof(databasePath: string, sessionSecret: string): string;
export function matchesSmokeDatabaseProof(
  proof: string | null,
  databasePath: string,
  sessionSecret: string,
): boolean;
