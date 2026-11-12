import type Database from "better-sqlite3";

export type WorkspaceExecutionLeaseOutcome =
  { status: "acquired"; token: string } | { status: "busy" } | { status: "missing" };

export type WorkspaceExecutionLeaseStore = {
  acquire(userId: string, workspaceId: string, token: string): WorkspaceExecutionLeaseOutcome;
  refresh(userId: string, workspaceId: string, token: string): boolean;
  release(userId: string, workspaceId: string, token: string): void;
};

export function createWorkspaceExecutionLeaseStore(
  database: Database.Database,
  durationMs?: number,
): WorkspaceExecutionLeaseStore;
