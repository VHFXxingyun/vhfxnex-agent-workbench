import "server-only";
import database, { type DbWorkspace } from "@/lib/db";
import { accountDataLimits } from "@/lib/limits";
import { isWorkspace, WORKSPACE_LIMITS } from "@/lib/workspace-validation";
import {
  combineAiUsage,
  type AiRunUsage,
  type ChatAttachment,
  type ConversationMessage,
  type Workspace,
} from "@/lib/goal";
import { createWorkspaceExecutionLeaseStore } from "@/lib/workspace-execution-lease.mjs";

export type WorkspaceSaveOutcome =
  "saved" | "conflict" | "limit" | "too-large" | "invalid" | "locked";
export type WorkspaceUpdateOutcome = "saved" | "missing" | "too-large" | "invalid" | "locked";
const executionLeases = createWorkspaceExecutionLeaseStore(database);
export const acquireWorkspaceExecutionLease = executionLeases.acquire;
export const refreshWorkspaceExecutionLease = executionLeases.refresh;
export const releaseWorkspaceExecutionLease = executionLeases.release;

export function hasActiveWorkspaceExecution(userId: string, workspaceId: string): boolean {
  return Boolean(
    database
      .prepare(
        "SELECT 1 FROM workspace_execution_locks WHERE workspace_id = ? AND user_id = ? AND expires_at > ?",
      )
      .get(workspaceId, userId, Date.now()),
  );
}

export type WorkspaceExecutionStatus = {
  token: string;
  workspaceId: string;
  workspaceTitle: string;
  state: "running" | "completed" | "failed";
  activity: string;
  completedToolCalls: number;
  message?: string;
  cancelRequested?: boolean;
  startedAt: string;
  updatedAt: string;
};

type DbWorkspaceExecutionStatus = {
  token: string;
  workspace_id: string;
  workspace_title: string;
  state: WorkspaceExecutionStatus["state"];
  activity: string;
  completed_tool_calls: number;
  message: string | null;
  cancel_requested_at: string | null;
  started_at: string;
  updated_at: string;
};

function decodeWorkspaceExecutionStatus(row: DbWorkspaceExecutionStatus): WorkspaceExecutionStatus {
  return {
    token: row.token,
    workspaceId: row.workspace_id,
    workspaceTitle: row.workspace_title,
    state: row.state,
    activity: row.activity,
    completedToolCalls: row.completed_tool_calls,
    ...(row.message ? { message: row.message } : {}),
    ...(row.cancel_requested_at ? { cancelRequested: true } : {}),
    startedAt: row.started_at,
    updatedAt: row.updated_at,
  };
}

export function startWorkspaceExecutionStatus(
  userId: string,
  workspaceId: string,
  token: string,
  workspaceTitle: string,
  activity: string,
): boolean {
  const now = new Date().toISOString();
  return database.transaction(() => {
    database
      .prepare("DELETE FROM workspace_execution_status WHERE user_id = ? AND updated_at < ?")
      .run(userId, new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString());
    return (
      database
        .prepare(
          `INSERT INTO workspace_execution_status
          (token, workspace_id, user_id, workspace_title, state, activity,
           completed_tool_calls, message, started_at, updated_at, finished_at)
         SELECT ?, w.id, w.user_id, ?, 'running', ?, 0, NULL, ?, ?, NULL
           FROM workspaces w WHERE w.id = ? AND w.user_id = ?`,
        )
        .run(
          token,
          workspaceTitle.slice(0, 160),
          activity.slice(0, 240),
          now,
          now,
          workspaceId,
          userId,
        ).changes === 1
    );
  })();
}

export function updateWorkspaceExecutionStatus(
  userId: string,
  workspaceId: string,
  token: string,
  activity: string,
  completedToolCalls: number,
): boolean {
  const now = new Date().toISOString();
  return (
    database
      .prepare(
        `UPDATE workspace_execution_status SET activity = ?, completed_tool_calls = ?, updated_at = ?
         WHERE token = ? AND user_id = ? AND workspace_id = ? AND state = 'running'`,
      )
      .run(
        activity.slice(0, 240),
        Math.max(0, Math.floor(completedToolCalls)),
        now,
        token,
        userId,
        workspaceId,
      ).changes === 1
  );
}

export function requestWorkspaceExecutionCancellationForUser(
  userId: string,
  workspaceId: string,
): boolean {
  const now = new Date().toISOString();
  return (
    database
      .prepare(
        `UPDATE workspace_execution_status
           SET cancel_requested_at = COALESCE(cancel_requested_at, ?),
               activity = '正在停止任务…', updated_at = ?
         WHERE user_id = ? AND workspace_id = ? AND state = 'running'
           AND EXISTS (
             SELECT 1 FROM workspace_execution_locks l
             WHERE l.workspace_id = workspace_execution_status.workspace_id
               AND l.user_id = workspace_execution_status.user_id
               AND l.token = workspace_execution_status.token AND l.expires_at > ?
           )`,
      )
      .run(now, now, userId, workspaceId, Date.now()).changes === 1
  );
}

export function isWorkspaceExecutionCancellationRequested(
  userId: string,
  workspaceId: string,
  token: string,
): boolean {
  return Boolean(
    database
      .prepare(
        `SELECT 1 FROM workspace_execution_status
         WHERE token = ? AND user_id = ? AND workspace_id = ? AND state = 'running'
           AND cancel_requested_at IS NOT NULL`,
      )
      .get(token, userId, workspaceId),
  );
}

export function finishWorkspaceExecutionStatus(
  userId: string,
  workspaceId: string,
  token: string,
  result: {
    state: "completed" | "failed";
    activity: string;
    message?: string;
    completedToolCalls: number;
  },
): boolean {
  const now = new Date().toISOString();
  return (
    database
      .prepare(
        `UPDATE workspace_execution_status
           SET state = ?, activity = ?, message = ?, completed_tool_calls = ?, updated_at = ?, finished_at = ?
         WHERE token = ? AND user_id = ? AND workspace_id = ? AND state = 'running'`,
      )
      .run(
        result.state,
        result.activity.slice(0, 240),
        result.message?.slice(0, 1000) || null,
        Math.max(0, Math.floor(result.completedToolCalls)),
        now,
        now,
        token,
        userId,
        workspaceId,
      ).changes === 1
  );
}

export function listWorkspaceExecutionStatusesForUser(userId: string): WorkspaceExecutionStatus[] {
  return database.transaction(() => {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    database
      .prepare(
        `UPDATE workspace_execution_status SET state = 'failed', activity = '上次执行中断',
           message = '本轮连接已中断，已保存内容保留；未完成的交接任务会重新排队。',
           updated_at = ?, finished_at = ?
         WHERE user_id = ? AND state = 'running'
           AND NOT EXISTS (
             SELECT 1 FROM workspace_execution_locks l
             WHERE l.workspace_id = workspace_execution_status.workspace_id
               AND l.user_id = workspace_execution_status.user_id
               AND l.token = workspace_execution_status.token AND l.expires_at > ?
           )`,
      )
      .run(nowIso, nowIso, userId, now);
    const rows = database
      .prepare(
        `SELECT token, workspace_id, workspace_title, state, activity, completed_tool_calls,
                message, cancel_requested_at, started_at, updated_at
         FROM workspace_execution_status WHERE user_id = ?
         ORDER BY CASE state WHEN 'running' THEN 0 ELSE 1 END, updated_at DESC LIMIT 20`,
      )
      .all(userId) as DbWorkspaceExecutionStatus[];
    return rows.map(decodeWorkspaceExecutionStatus);
  })();
}

export type WorkbenchHandoff = {
  id: string;
  workspaceId: string;
  workspaceTitle: string;
  instruction: string;
  userMessageId: string;
  userMessage: string;
  attachments: ChatAttachment[];
  createdAt: string;
};

type DbWorkbenchHandoff = {
  id: string;
  workspace_id: string;
  workspace_title: string;
  instruction: string;
  user_message_id: string;
  user_message: string;
  attachments_json: string;
  created_at: string;
};

function decodeWorkbenchHandoff(row: DbWorkbenchHandoff): WorkbenchHandoff | null {
  try {
    const attachments: unknown = JSON.parse(row.attachments_json);
    if (!Array.isArray(attachments)) return null;
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      workspaceTitle: row.workspace_title,
      instruction: row.instruction,
      userMessageId: row.user_message_id,
      userMessage: row.user_message,
      attachments: attachments as ChatAttachment[],
      createdAt: row.created_at,
    };
  } catch {
    return null;
  }
}

export function enqueueWorkbenchHandoffForUser(
  userId: string,
  input: Omit<WorkbenchHandoff, "workspaceTitle" | "createdAt">,
  assistantMessage?: ConversationMessage,
): {
  status: "queued" | "existing" | "completed" | "cancelled" | "missing" | "invalid" | "limit";
  handoff?: WorkbenchHandoff;
} {
  const now = new Date().toISOString();
  const attachmentsJson = JSON.stringify(input.attachments);
  return database
    .transaction(() => {
      database
        .prepare(
          "DELETE FROM workbench_handoffs WHERE user_id = ? AND status IN ('completed', 'cancelled') AND updated_at < ?",
        )
        .run(userId, new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString());
      const workspace = database
        .prepare("SELECT title, body FROM workspaces WHERE id = ? AND user_id = ?")
        .get(input.workspaceId, userId) as { title: string; body: string } | undefined;
      if (!workspace) return { status: "missing" as const };
      let decodedWorkspace: unknown;
      try {
        decodedWorkspace = JSON.parse(workspace.body);
      } catch {
        return { status: "invalid" as const };
      }
      if (
        !isWorkspace(decodedWorkspace) ||
        !decodedWorkspace.conversation?.some(
          (message) => message.id === input.userMessageId && message.role === "user",
        )
      )
        return { status: "invalid" as const };

      const nextWorkspace: Workspace = assistantMessage
        ? {
            ...decodedWorkspace,
            conversation: mergeConversations(decodedWorkspace.conversation, [assistantMessage]),
          }
        : decodedWorkspace;
      if (!isWorkspace(nextWorkspace)) return { status: "invalid" as const };
      const serializedWorkspace = JSON.stringify(nextWorkspace);
      if (Buffer.byteLength(serializedWorkspace, "utf8") > accountDataLimits.workspaceBytes)
        return { status: "limit" as const };

      const existing = database
        .prepare(
          `SELECT h.*, w.title AS workspace_title, h.status AS handoff_status FROM workbench_handoffs h
           JOIN workspaces w ON w.id = h.workspace_id
           WHERE h.user_id = ? AND h.user_message_id = ?`,
        )
        .get(userId, input.userMessageId) as
        (DbWorkbenchHandoff & { handoff_status: string }) | undefined;
      if (existing) {
        const handoff = decodeWorkbenchHandoff(existing);
        if (!handoff) return { status: "invalid" as const };
        if (assistantMessage) {
          database
            .prepare("UPDATE workspaces SET body = ?, updated_at = ? WHERE id = ? AND user_id = ?")
            .run(serializedWorkspace, now, input.workspaceId, userId);
        }
        if (existing.handoff_status === "completed")
          return { status: "completed" as const, handoff };
        if (existing.handoff_status === "cancelled")
          return { status: "cancelled" as const, handoff };
        return { status: "existing" as const, handoff };
      }

      const pendingCount = database
        .prepare(
          "SELECT COUNT(*) AS count FROM workbench_handoffs WHERE user_id = ? AND status IN ('pending', 'running')",
        )
        .get(userId) as { count: number };
      if (pendingCount.count >= 20) return { status: "limit" as const };
      const pendingBytes = database
        .prepare(
          "SELECT COALESCE(SUM(LENGTH(attachments_json)), 0) AS bytes FROM workbench_handoffs WHERE user_id = ? AND status IN ('pending', 'running')",
        )
        .get(userId) as { bytes: number };
      if (
        pendingBytes.bytes + Buffer.byteLength(attachmentsJson, "utf8") >
        accountDataLimits.backupBytes
      )
        return { status: "limit" as const };

      database
        .prepare(
          `INSERT INTO workbench_handoffs
            (id, user_id, workspace_id, instruction, user_message_id, user_message,
             attachments_json, status, claim_token, claim_expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`,
        )
        .run(
          input.id,
          userId,
          input.workspaceId,
          input.instruction,
          input.userMessageId,
          input.userMessage,
          attachmentsJson,
          now,
          now,
        );
      if (assistantMessage) {
        database
          .prepare("UPDATE workspaces SET body = ?, updated_at = ? WHERE id = ? AND user_id = ?")
          .run(serializedWorkspace, now, input.workspaceId, userId);
      }
      return {
        status: "queued" as const,
        handoff: {
          ...input,
          workspaceTitle: workspace.title,
          createdAt: now,
        },
      };
    })
    .immediate();
}

export function listPendingWorkbenchHandoffsForUser(userId: string): WorkbenchHandoff[] {
  return database.transaction(() => {
    const now = Date.now();
    database
      .prepare(
        `UPDATE workbench_handoffs SET status = 'pending', claim_token = NULL,
             claim_expires_at = NULL, updated_at = ?
           WHERE user_id = ? AND status = 'running' AND claim_expires_at <= ?
             AND NOT EXISTS (
               SELECT 1 FROM workspace_execution_locks l
               WHERE l.workspace_id = workbench_handoffs.workspace_id
                 AND l.user_id = workbench_handoffs.user_id AND l.expires_at > ?
             )`,
      )
      .run(new Date(now).toISOString(), userId, now, now);
    const rows = database
      .prepare(
        `SELECT h.*, w.title AS workspace_title FROM workbench_handoffs h
           JOIN workspaces w ON w.id = h.workspace_id
           WHERE h.user_id = ? AND h.status = 'pending' ORDER BY h.created_at ASC LIMIT 20`,
      )
      .all(userId) as DbWorkbenchHandoff[];
    return rows.flatMap((row) => {
      const handoff = decodeWorkbenchHandoff(row);
      return handoff ? [handoff] : [];
    });
  })();
}

export function claimWorkbenchHandoffForUser(
  userId: string,
  handoffId: string,
  token: string,
): { status: "claimed" | "busy" | "missing"; handoff?: WorkbenchHandoff } {
  return database
    .transaction(() => {
      const row = database
        .prepare(
          `SELECT h.*, w.title AS workspace_title, h.status, h.claim_token,
                  h.claim_expires_at
           FROM workbench_handoffs h JOIN workspaces w ON w.id = h.workspace_id
           WHERE h.id = ? AND h.user_id = ?`,
        )
        .get(handoffId, userId) as
        | (DbWorkbenchHandoff & {
            status: string;
            claim_token: string | null;
            claim_expires_at: number | null;
          })
        | undefined;
      if (!row || (row.status !== "pending" && row.status !== "running"))
        return { status: "missing" as const };
      const now = Date.now();
      const activeLease = database
        .prepare(
          "SELECT 1 FROM workspace_execution_locks WHERE workspace_id = ? AND user_id = ? AND expires_at > ?",
        )
        .get(row.workspace_id, userId, now);
      const claimIsActive = row.status === "running" && (row.claim_expires_at || 0) > now;
      if (activeLease || (claimIsActive && row.claim_token !== token))
        return { status: "busy" as const };
      const expiresAt = now + 10 * 60_000;
      const changed = database
        .prepare(
          `UPDATE workbench_handoffs SET status = 'running', claim_token = ?,
             claim_expires_at = ?, updated_at = ?
           WHERE id = ? AND user_id = ? AND (status = 'pending' OR claim_expires_at <= ?)`,
        )
        .run(token, expiresAt, new Date(now).toISOString(), handoffId, userId, now);
      if (!changed.changes) return { status: "busy" as const };
      const handoff = decodeWorkbenchHandoff(row);
      return handoff ? { status: "claimed" as const, handoff } : { status: "missing" as const };
    })
    .immediate();
}

export function isWorkbenchHandoffClaimValid(
  userId: string,
  handoffId: string,
  workspaceId: string,
  token: string,
): boolean {
  return Boolean(
    database
      .prepare(
        `SELECT 1 FROM workbench_handoffs WHERE id = ? AND user_id = ? AND workspace_id = ?
         AND status = 'running' AND claim_token = ? AND claim_expires_at > ?`,
      )
      .get(handoffId, userId, workspaceId, token, Date.now()),
  );
}

export function refreshWorkbenchHandoffClaimForUser(
  userId: string,
  handoffId: string,
  token: string,
): boolean {
  const now = Date.now();
  return (
    database
      .prepare(
        `UPDATE workbench_handoffs SET claim_expires_at = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'running' AND claim_token = ?
           `,
      )
      .run(now + 10 * 60_000, new Date(now).toISOString(), handoffId, userId, token).changes === 1
  );
}

export function completeWorkbenchHandoffForUser(
  userId: string,
  handoffId: string,
  token: string,
): boolean {
  return (
    database
      .prepare(
        `UPDATE workbench_handoffs SET status = 'completed', attachments_json = '[]', claim_token = NULL,
           claim_expires_at = NULL, updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'running' AND claim_token = ?`,
      )
      .run(new Date().toISOString(), handoffId, userId, token).changes === 1
  );
}

export function releaseWorkbenchHandoffForUser(
  userId: string,
  handoffId: string,
  token: string,
): boolean {
  return (
    database
      .prepare(
        `UPDATE workbench_handoffs SET status = 'pending', claim_token = NULL,
           claim_expires_at = NULL, updated_at = ?
         WHERE id = ? AND user_id = ? AND status = 'running' AND claim_token = ?`,
      )
      .run(new Date().toISOString(), handoffId, userId, token).changes === 1
  );
}

export function cancelWorkbenchHandoffForUser(
  userId: string,
  handoffId: string,
  token?: string,
): boolean {
  return (
    database
      .prepare(
        `UPDATE workbench_handoffs SET status = 'cancelled', attachments_json = '[]', claim_token = NULL,
           claim_expires_at = NULL, updated_at = ?
         WHERE id = ? AND user_id = ? AND status IN ('pending', 'running')
           AND (status = 'pending' OR claim_token = ?)`,
      )
      .run(new Date().toISOString(), handoffId, userId, token || "").changes === 1
  );
}

function mergeConversations(
  current: ConversationMessage[] | undefined,
  incoming: ConversationMessage[] | undefined,
) {
  const byId = new Map<string, ConversationMessage>();
  for (const message of [...(current || []), ...(incoming || [])]) byId.set(message.id, message);
  return [...byId.values()].slice(-WORKSPACE_LIMITS.conversationMessages);
}

export function countWorkspacesForUser(userId: string): number {
  return (
    database.prepare("SELECT COUNT(*) AS count FROM workspaces WHERE user_id = ?").get(userId) as {
      count: number;
    }
  ).count;
}

export function getWorkspaceForUser(userId: string, workspaceId: string): Workspace | null {
  const row = database
    .prepare("SELECT body FROM workspaces WHERE id = ? AND user_id = ?")
    .get(workspaceId, userId) as Pick<DbWorkspace, "body"> | undefined;
  if (!row) return null;
  try {
    const workspace: unknown = JSON.parse(row.body);
    return isWorkspace(workspace) ? workspace : null;
  } catch {
    return null;
  }
}

export function saveWorkspaceForUser(userId: string, value: unknown): WorkspaceSaveOutcome {
  if (!isWorkspace(value)) return "invalid";
  const incomingWorkspace = value;
  const now = new Date().toISOString();

  return database
    .transaction(() => {
      const existing = database
        .prepare("SELECT id, body FROM workspaces WHERE id = ? AND user_id = ?")
        .get(incomingWorkspace.id, userId);
      if (
        existing &&
        database
          .prepare(
            "SELECT 1 FROM workspace_execution_locks WHERE workspace_id = ? AND expires_at > ?",
          )
          .get(incomingWorkspace.id, Date.now())
      )
        return "locked" as const;
      if (
        !existing &&
        database.prepare("SELECT id FROM workspaces WHERE id = ?").get(incomingWorkspace.id)
      ) {
        return "conflict" as const;
      }
      let workspace = incomingWorkspace;
      if (existing) {
        const row = existing as Pick<DbWorkspace, "body">;
        try {
          const current: unknown = JSON.parse(row.body);
          if (isWorkspace(current)) {
            workspace = {
              ...incomingWorkspace,
              conversation: mergeConversations(
                current.conversation,
                incomingWorkspace.conversation,
              ),
            };
          }
        } catch {
          // A malformed stored body is repaired by the validated incoming workspace.
        }
      }
      if (!isWorkspace(workspace)) return "invalid" as const;
      const serialized = JSON.stringify(workspace);
      if (Buffer.byteLength(serialized, "utf8") > accountDataLimits.workspaceBytes)
        return "too-large" as const;
      if (!existing) {
        const count = countWorkspacesForUser(userId);
        if (count >= accountDataLimits.workspaces) return "limit" as const;
        database
          .prepare(
            "INSERT INTO workspaces (id, user_id, title, category, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            workspace.id,
            userId,
            workspace.plan.title,
            workspace.plan.category,
            serialized,
            workspace.createdAt || now,
            now,
          );
      } else {
        database
          .prepare(
            "UPDATE workspaces SET title = ?, category = ?, body = ?, updated_at = ? WHERE id = ? AND user_id = ?",
          )
          .run(
            workspace.plan.title,
            workspace.plan.category,
            serialized,
            now,
            workspace.id,
            userId,
          );
      }
      return "saved" as const;
    })
    .immediate();
}

export function updateExistingWorkspaceForUser(
  userId: string,
  value: unknown,
  executionLeaseToken?: string,
  usageDelta?: AiRunUsage,
): WorkspaceUpdateOutcome {
  if (!isWorkspace(value)) return "invalid";
  const incomingWorkspace = value;

  return database
    .transaction(() => {
      const existing = database
        .prepare("SELECT id, body FROM workspaces WHERE id = ? AND user_id = ?")
        .get(incomingWorkspace.id, userId);
      if (!existing) return "missing" as const;
      const now = Date.now();
      const activeLease = database
        .prepare(
          "SELECT token, expires_at FROM workspace_execution_locks WHERE workspace_id = ? AND user_id = ?",
        )
        .get(incomingWorkspace.id, userId) as { token: string; expires_at: number } | undefined;
      if (executionLeaseToken) {
        if (
          !activeLease ||
          activeLease.token !== executionLeaseToken ||
          activeLease.expires_at <= now
        )
          return "locked" as const;
      } else if (activeLease && activeLease.expires_at > now) {
        return "locked" as const;
      }
      let currentWorkspace: Workspace | null = null;
      try {
        const current: unknown = JSON.parse((existing as Pick<DbWorkspace, "body">).body);
        if (isWorkspace(current)) currentWorkspace = current;
      } catch {
        // The validated execution checkpoint can recover a malformed body.
      }
      const workspace: Workspace = {
        ...incomingWorkspace,
        ...(currentWorkspace
          ? {
              conversation: mergeConversations(
                currentWorkspace.conversation,
                incomingWorkspace.conversation,
              ),
            }
          : {}),
        usage: usageDelta
          ? combineAiUsage(currentWorkspace?.usage, usageDelta)
          : (currentWorkspace?.usage ?? incomingWorkspace.usage),
      };
      if (!isWorkspace(workspace)) return "invalid" as const;
      const serialized = JSON.stringify(workspace);
      if (Buffer.byteLength(serialized, "utf8") > accountDataLimits.workspaceBytes)
        return "too-large" as const;
      database
        .prepare(
          "UPDATE workspaces SET title = ?, category = ?, body = ?, updated_at = ? WHERE id = ? AND user_id = ?",
        )
        .run(
          workspace.plan.title,
          workspace.plan.category,
          serialized,
          new Date().toISOString(),
          workspace.id,
          userId,
        );
      return "saved" as const;
    })
    .immediate();
}

export function appendWorkspaceConversationForUser(
  userId: string,
  workspaceId: string,
  messages: ConversationMessage[],
): WorkspaceUpdateOutcome {
  return database
    .transaction(() => {
      const row = database
        .prepare("SELECT body FROM workspaces WHERE id = ? AND user_id = ?")
        .get(workspaceId, userId) as Pick<DbWorkspace, "body"> | undefined;
      if (!row) return "missing" as const;
      let current: unknown;
      try {
        current = JSON.parse(row.body);
      } catch {
        return "invalid" as const;
      }
      if (!isWorkspace(current)) return "invalid" as const;
      const workspace: Workspace = {
        ...current,
        conversation: mergeConversations(current.conversation, messages),
      };
      if (!isWorkspace(workspace)) return "invalid" as const;
      const serialized = JSON.stringify(workspace);
      if (Buffer.byteLength(serialized, "utf8") > accountDataLimits.workspaceBytes)
        return "too-large" as const;
      database
        .prepare("UPDATE workspaces SET body = ?, updated_at = ? WHERE id = ? AND user_id = ?")
        .run(serialized, new Date().toISOString(), workspaceId, userId);
      return "saved" as const;
    })
    .immediate();
}

export function addWorkspaceUsageForUser(
  userId: string,
  workspaceId: string,
  usage: AiRunUsage,
): WorkspaceUpdateOutcome {
  if (usage.totalTokens <= 0) return "saved";
  return database.transaction(() => {
    const row = database
      .prepare("SELECT body FROM workspaces WHERE id = ? AND user_id = ?")
      .get(workspaceId, userId) as Pick<DbWorkspace, "body"> | undefined;
    if (!row) return "missing" as const;

    let value: unknown;
    try {
      value = JSON.parse(row.body);
    } catch {
      return "invalid" as const;
    }
    if (!isWorkspace(value)) return "invalid" as const;

    const workspace: Workspace = {
      ...value,
      usage: combineAiUsage(value.usage, usage),
      mode: "live",
    };
    const serialized = JSON.stringify(workspace);
    if (Buffer.byteLength(serialized, "utf8") > accountDataLimits.workspaceBytes)
      return "too-large" as const;
    database
      .prepare("UPDATE workspaces SET body = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(serialized, new Date().toISOString(), workspaceId, userId);
    return "saved" as const;
  })();
}
