import "server-only";
import database from "@/lib/db";
import { buildWorkbenchHandoffResultMessage } from "@/lib/supervisor-handoff-result.mjs";

export type SupervisorConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  workspaceId?: string;
};

const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 5_000;
const MAX_CONVERSATION_BYTES = 100_000;

function parseConversation(value: string | undefined): SupervisorConversationMessage[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) =>
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof item.id === "string" &&
      (item.role === "user" || item.role === "assistant") &&
      typeof item.content === "string"
        ? [
            {
              id: item.id.slice(0, 80),
              role: item.role,
              content: item.content.slice(0, MAX_MESSAGE_CHARS),
              ...(typeof item.workspaceId === "string" &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                item.workspaceId,
              )
                ? { workspaceId: item.workspaceId }
                : {}),
            },
          ]
        : [],
    );
  } catch {
    return [];
  }
}

export function getSupervisorConversationForUser(userId: string) {
  const row = database
    .prepare("SELECT body FROM supervisor_conversations WHERE user_id = ?")
    .get(userId) as { body: string } | undefined;
  return parseConversation(row?.body);
}

export function appendSupervisorConversationForUser(
  userId: string,
  messages: SupervisorConversationMessage[],
): boolean {
  if (
    !Array.isArray(messages) ||
    messages.some(
      (message) =>
        !message ||
        typeof message.id !== "string" ||
        message.id.length > 80 ||
        (message.role !== "user" && message.role !== "assistant") ||
        typeof message.content !== "string" ||
        (message.workspaceId !== undefined &&
          (message.role !== "assistant" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
              message.workspaceId,
            ))),
    )
  )
    return false;

  const now = new Date().toISOString();
  return database
    .transaction(() => {
      const current = getSupervisorConversationForUser(userId);
      const byId = new Map(current.map((message) => [message.id, message]));
      for (const message of messages) {
        byId.set(message.id, {
          id: message.id,
          role: message.role,
          content: message.content.slice(0, MAX_MESSAGE_CHARS),
          ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
        });
      }
      let next = [...byId.values()].slice(-MAX_MESSAGES);
      while (
        next.length > 1 &&
        Buffer.byteLength(JSON.stringify(next), "utf8") > MAX_CONVERSATION_BYTES
      )
        next = next.slice(1);
      if (Buffer.byteLength(JSON.stringify(next), "utf8") > MAX_CONVERSATION_BYTES) return false;
      database
        .prepare(
          `INSERT INTO supervisor_conversations (user_id, body, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
        )
        .run(userId, JSON.stringify(next), now);
      return true;
    })
    .immediate();
}

export function appendWorkbenchCompletionForUser(
  userId: string,
  input: {
    handoffId: string;
    workspaceId: string;
    workspaceTitle: string;
    outcome?: "completed" | "interrupted" | "cancelled" | "failed";
    summary: string;
    completedTasks: number;
    totalTasks: number;
    completedToolCalls?: number;
    artifactTitles: string[];
  },
): boolean {
  const content = buildWorkbenchHandoffResultMessage(input).slice(0, MAX_MESSAGE_CHARS);
  return appendSupervisorConversationForUser(userId, [
    {
      id: `handoff-result:${input.handoffId}`,
      role: "assistant",
      content,
      workspaceId: input.workspaceId,
    },
  ]);
}

export function clearSupervisorConversationForUser(userId: string) {
  return database.prepare("DELETE FROM supervisor_conversations WHERE user_id = ?").run(userId)
    .changes;
}
