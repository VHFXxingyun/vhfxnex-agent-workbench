export function createWorkspaceExecutionLeaseStore(database, durationMs = 10 * 60_000) {
  return {
    acquire(userId, workspaceId, token) {
      const now = Date.now();
      return database
        .transaction(() => {
          const workspace = database
            .prepare("SELECT id FROM workspaces WHERE id = ? AND user_id = ?")
            .get(workspaceId, userId);
          if (!workspace) return { status: "missing" };

          const result = database
            .prepare(
              `INSERT INTO workspace_execution_locks (workspace_id, user_id, token, expires_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(workspace_id) DO UPDATE SET
                 user_id = excluded.user_id,
                 token = excluded.token,
                 expires_at = excluded.expires_at
               WHERE workspace_execution_locks.expires_at <= ?`,
            )
            .run(workspaceId, userId, token, now + durationMs, now);
          return result.changes === 1 ? { status: "acquired", token } : { status: "busy" };
        })
        .immediate();
    },

    refresh(userId, workspaceId, token) {
      const now = Date.now();
      return (
        database
          .prepare(
            `UPDATE workspace_execution_locks SET expires_at = ?
             WHERE workspace_id = ? AND user_id = ? AND token = ? AND expires_at > ?`,
          )
          .run(now + durationMs, workspaceId, userId, token, now).changes === 1
      );
    },

    release(userId, workspaceId, token) {
      database
        .prepare(
          "DELETE FROM workspace_execution_locks WHERE workspace_id = ? AND user_id = ? AND token = ?",
        )
        .run(workspaceId, userId, token);
    },
  };
}
