import type { AiRunUsage, ConversationMessage, GoalPlan, RouteOption, Workspace } from "@/lib/goal";
import { normalizeProjectPath, projectPathKey } from "@/lib/project-path.mjs";

export const WORKSPACE_LIMITS = {
  planTasks: 40,
  executionTasks: 60,
  milestones: 100,
  artifacts: 100,
  events: 100,
  conversationMessages: 40,
} as const;

// File names may be localized; the shared path guard keeps them safe to extract on common OSes.
function isProjectFile(value: unknown): boolean {
  return (
    isRecord(value) &&
    isText(value.path, 120) &&
    normalizeProjectPath(value.path) !== null &&
    typeof value.content === "string" &&
    value.content.length <= 45_000
  );
}

function isConversationMessage(value: unknown): value is ConversationMessage {
  if (
    !isRecord(value) ||
    !isText(value.id, 100) ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.content !== "string" ||
    value.content.length > 5000 ||
    (value.agent !== undefined &&
      value.agent !== "planner" &&
      value.agent !== "dialogue" &&
      value.agent !== "workbench")
  )
    return false;
  if (
    value.progress !== undefined &&
    (!Array.isArray(value.progress) ||
      value.progress.length > 12 ||
      !value.progress.every((item) => isText(item, 240)))
  )
    return false;
  if (value.toolEvents === undefined) return true;
  return (
    Array.isArray(value.toolEvents) &&
    value.toolEvents.length <= 20 &&
    value.toolEvents.every(
      (event) =>
        isRecord(event) &&
        isText(event.id, 100) &&
        isText(event.name, 100) &&
        isText(event.title, 200) &&
        typeof event.detail === "string" &&
        event.detail.length <= 1000 &&
        (event.sources === undefined ||
          (Array.isArray(event.sources) &&
            event.sources.length <= 5 &&
            event.sources.every(
              (source) =>
                isRecord(source) &&
                isText(source.title, 300) &&
                isText(source.url, 2000) &&
                /^https?:\/\//i.test(source.url) &&
                typeof source.snippet === "string" &&
                source.snippet.length <= 1200,
            ))) &&
        (event.status === "done" || event.status === "running"),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function isAiRunUsage(value: unknown): value is AiRunUsage {
  if (!isRecord(value)) return false;
  const { model, inputTokens, cachedInputTokens, outputTokens, totalTokens, latencyMs, requests } =
    value;
  return (
    isText(model, 80) &&
    [inputTokens, outputTokens, totalTokens, latencyMs, requests].every(
      (item) => typeof item === "number" && Number.isSafeInteger(item) && item >= 0,
    ) &&
    (cachedInputTokens === undefined ||
      (typeof cachedInputTokens === "number" &&
        Number.isSafeInteger(cachedInputTokens) &&
        cachedInputTokens >= 0 &&
        cachedInputTokens <= (inputTokens as number))) &&
    (inputTokens as number) + (outputTokens as number) <= (totalTokens as number) &&
    (requests as number) <= 10_000
  );
}

function isTextList(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((item) => typeof item === "string" && item.length <= maxLength)
  );
}

function isTask(value: unknown): boolean {
  return (
    isRecord(value) &&
    isText(value.id, 100) &&
    isText(value.title, 160) &&
    typeof value.detail === "string" &&
    value.detail.length <= 1000 &&
    isText(value.phase, 80) &&
    (value.status === "pending" || value.status === "done")
  );
}

export function isRouteOption(value: unknown): value is RouteOption {
  return (
    isRecord(value) &&
    isText(value.id, 100) &&
    isText(value.title, 160) &&
    isText(value.subtitle, 240) &&
    typeof value.fit === "number" &&
    Number.isFinite(value.fit) &&
    value.fit >= 0 &&
    value.fit <= 100 &&
    isText(value.reason, 1000) &&
    (value.accent === "violet" || value.accent === "cyan" || value.accent === "amber")
  );
}

export function isGoalPlan(value: unknown): value is GoalPlan {
  return (
    isRecord(value) &&
    isText(value.title, 200) &&
    isBoundedText(value.category, 100) &&
    isBoundedText(value.summary, 2000) &&
    isTextList(value.constraints, 20, 500) &&
    isBoundedText(value.question, 1500) &&
    Array.isArray(value.routes) &&
    value.routes.length > 0 &&
    value.routes.length <= 3 &&
    value.routes.every(isRouteOption) &&
    Array.isArray(value.tasks) &&
    value.tasks.length <= WORKSPACE_LIMITS.planTasks &&
    value.tasks.every(isTask) &&
    Array.isArray(value.sources) &&
    value.sources.length <= 10 &&
    value.sources.every(
      (source) =>
        isRecord(source) &&
        isText(source.id, 100) &&
        isText(source.title, 200) &&
        typeof source.excerpt === "string" &&
        source.excerpt.length <= 1500 &&
        typeof source.score === "number" &&
        Number.isFinite(source.score),
    )
  );
}

function isExecutionResult(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (
    !isText(value.summary, 3000) ||
    !Array.isArray(value.tasks) ||
    value.tasks.length > WORKSPACE_LIMITS.executionTasks ||
    !value.tasks.every(isTask) ||
    !Array.isArray(value.milestones) ||
    value.milestones.length > WORKSPACE_LIMITS.milestones ||
    !value.milestones.every(
      (milestone) =>
        isRecord(milestone) &&
        isText(milestone.label, 160) &&
        isText(milestone.date, 100) &&
        typeof milestone.note === "string" &&
        milestone.note.length <= 1000,
    ) ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length > WORKSPACE_LIMITS.artifacts ||
    !value.artifacts.every(
      (artifact) =>
        isRecord(artifact) &&
        isText(artifact.id, 100) &&
        (artifact.type === "document" ||
          artifact.type === "pdf" ||
          artifact.type === "budget" ||
          artifact.type === "timeline" ||
          artifact.type === "code" ||
          artifact.type === "spreadsheet" ||
          artifact.type === "presentation") &&
        isText(artifact.title, 200) &&
        typeof artifact.description === "string" &&
        artifact.description.length <= 500 &&
        typeof artifact.content === "string" &&
        (artifact.type === "code"
          ? Array.isArray(artifact.files) &&
            artifact.files.length > 0 &&
            artifact.files.length <= 20 &&
            artifact.files.every(isProjectFile) &&
            artifact.files.reduce((total, file) => total + file.content.length, 0) <= 45_000 &&
            new Set(artifact.files.map((file) => projectPathKey(file.path))).size ===
              artifact.files.length
          : artifact.content.length <= 50000),
    ) ||
    !Array.isArray(value.events) ||
    value.events.length > WORKSPACE_LIMITS.events ||
    !value.events.every(
      (event) =>
        isRecord(event) &&
        isText(event.id, 100) &&
        isText(event.name, 100) &&
        isText(event.title, 200) &&
        typeof event.detail === "string" &&
        event.detail.length <= 1000 &&
        (event.sources === undefined ||
          (Array.isArray(event.sources) &&
            event.sources.length <= 5 &&
            event.sources.every(
              (source) =>
                isRecord(source) &&
                isText(source.title, 300) &&
                isText(source.url, 2000) &&
                /^https?:\/\//i.test(source.url) &&
                typeof source.snippet === "string" &&
                source.snippet.length <= 1200,
            ))) &&
        (event.status === "done" || event.status === "running"),
    )
  )
    return false;

  if (value.usage !== undefined && !isAiRunUsage(value.usage)) return false;

  if (value.budget === undefined) return true;
  if (!isRecord(value.budget)) return false;
  const { limit, total, remaining, status } = value.budget;
  return (
    (limit === null ||
      (typeof limit === "number" &&
        Number.isFinite(limit) &&
        limit >= 0 &&
        limit <= 1_000_000_000_000)) &&
    typeof total === "number" &&
    Number.isFinite(total) &&
    total >= 0 &&
    total <= 1_000_000_000_000 &&
    (remaining === null || (typeof remaining === "number" && Number.isFinite(remaining))) &&
    (status === "within" || status === "over" || status === "unknown")
  );
}

export function isWorkspace(value: unknown): value is Workspace {
  return (
    isRecord(value) &&
    isText(value.id, 100) &&
    isText(value.prompt, 4000) &&
    isGoalPlan(value.plan) &&
    isText(value.selectedRouteId, 100) &&
    value.plan.routes.some((route) => route.id === value.selectedRouteId) &&
    (value.result === null || isExecutionResult(value.result)) &&
    (value.conversation === undefined ||
      (Array.isArray(value.conversation) &&
        value.conversation.length <= WORKSPACE_LIMITS.conversationMessages &&
        value.conversation.every(isConversationMessage))) &&
    (value.usage === undefined || isAiRunUsage(value.usage)) &&
    isText(value.createdAt, 64) &&
    (value.mode === "live" || value.mode === "demo")
  );
}
