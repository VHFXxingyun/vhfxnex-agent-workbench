import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";

const baseUrl = new URL(process.env.NEXORA_BASE_URL || "http://localhost:3000");
if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(baseUrl.hostname)) {
  throw new Error("The search smoke check only runs against a local NEXORA server.");
}

const address = "198.51.100." + crypto.randomInt(1, 255);
const email = "nexora-search-" + crypto.randomUUID() + "@example.test";
const password = crypto.randomBytes(24).toString("base64url");
const goal = "查阅一份 Next.js 官方文档，为 Web 项目整理技术资料。";
const workspaceId = crypto.randomUUID();
let userId;
let sessionCookie;
let database;

async function request(route, { method = "GET", body, cookie, timeoutMs = 90_000 } = {}) {
  const headers = { Accept: "application/json", "X-Forwarded-For": address };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(new URL(route, baseUrl), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    return { response, payload: await response.json().catch(() => null), events: [] };
  }
  const text = await response.text();
  const events = text
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .flatMap((block) => {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      return data ? [JSON.parse(data)] : [];
    });
  const failure = events.find((event) => event.type === "error");
  const payload = events.find((event) => event.type === "result")?.data;
  return { response, payload: payload || (failure ? { error: failure.error } : null), events };
}

try {
  const health = await fetch(baseUrl);
  assert.equal(health.status, 200, "NEXORA preview must be available");

  const registration = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Search Smoke", email, password },
  });
  assert.equal(registration.response.status, 200);
  userId = registration.payload?.user?.id;
  assert.ok(userId);
  const setCookie =
    registration.response.headers.getSetCookie?.()[0] ||
    registration.response.headers.get("set-cookie");
  sessionCookie = setCookie?.split(";")[0];
  assert.ok(sessionCookie);

  const route = {
    id: "search-route",
    title: "官方资料核验",
    subtitle: "先查官方来源，再整理结论",
    fit: 95,
    reason: "用户明确要求查阅当前官方资料。",
    accent: "violet",
  };
  const plan = {
    title: "Next.js 官方资料",
    category: "开发者项目",
    summary: "查找与 Web 项目相关的官方资料。",
    constraints: [],
    routes: [route],
    tasks: [
      {
        id: "search-task",
        title: "查找官方文档",
        detail: "从可核验来源整理资料。",
        phase: "执行",
        status: "pending",
      },
    ],
    question: "要先查哪一部分？",
    sources: [],
  };
  const workspace = {
    id: workspaceId,
    prompt: goal,
    plan,
    selectedRouteId: route.id,
    result: null,
    createdAt: new Date().toISOString(),
    mode: "live",
  };
  const saved = await request("/api/workspaces", {
    method: "POST",
    cookie: sessionCookie,
    body: { workspace },
  });
  assert.equal(saved.response.status, 200, saved.payload?.error || "workspace save failed");

  const currentTasks = plan.tasks;
  const currentMilestones = [
    { label: "资料核验", date: "第 1 天", note: "只记录能追溯到来源的结论。" },
  ];
  const execution = await request("/api/execute", {
    method: "POST",
    cookie: sessionCookie,
    body: {
      workspaceId,
      goal,
      instruction:
        "请联网搜索 Next.js 官方 instrumentation 文档，用搜索结果回答并提供来源链接。不要改动任务。",
      continuation: true,
      plan,
      route,
      currentTasks,
      currentMilestones,
      demo: false,
      thinkingMode: "deep",
    },
  });
  assert.equal(
    execution.response.status,
    200,
    "search execution must start: " + (execution.payload?.error || ""),
  );
  assert.ok(
    execution.payload?.result?.events,
    "Agent must complete the search: " + JSON.stringify(execution.events.slice(-3)),
  );
  const streamedTextIndex = execution.events.findIndex(
    (event) => event.type === "text" && typeof event.text === "string" && event.text.trim(),
  );
  const finalResultIndex = execution.events.findIndex((event) => event.type === "result");
  assert.ok(streamedTextIndex >= 0, "the Agent must stream visible response text");
  assert.ok(
    finalResultIndex > streamedTextIndex,
    "response text must arrive before the final workspace result event",
  );
  assert.ok(
    execution.events.some(
      (event) => event.type === "status" && /深度思考/.test(event.message || ""),
    ),
    "deep thinking mode must announce its reasoning phase in the live stream",
  );
  const searchEvent = execution.payload.result.events.find((event) => event.name === "search_web");
  assert.ok(searchEvent, "an explicit request must call search_web");
  assert.ok(searchEvent.sources?.length, "search_web must return real source links");
  assert.ok(
    searchEvent.sources.every((source) => /^https?:\/\//i.test(source.url)),
    "search_web must return only safe HTTP(S) links",
  );
  assert.ok(
    execution.events.some(
      (event) => event.type === "tool" && event.name === "search_web" && event.sources?.length,
    ),
    "the SSE stream must expose sources on the completed tool event",
  );
  const persisted = await request("/api/workspaces/" + workspaceId, { cookie: sessionCookie });
  assert.ok(
    persisted.payload?.workspace?.result?.events.some(
      (event) => event.name === "search_web" && event.sources?.length,
    ),
    "source links must persist with the workspace",
  );
  console.log(
    "✓ Deep-thinking Agent web search returned " +
      searchEvent.sources.length +
      " links; response text, tool events, and source citations streamed and persisted.",
  );
} finally {
  if (sessionCookie) {
    await request("/api/workspaces/" + workspaceId, {
      method: "DELETE",
      cookie: sessionCookie,
      timeoutMs: 10_000,
    }).catch(() => {});
  }
  if (userId) {
    database = new Database(path.join(process.cwd(), "data", "goalflow.sqlite"), {
      timeout: 10_000,
    });
    database.transaction(() => {
      database.prepare("DELETE FROM ai_usage WHERE user_id = ?").run(userId);
      database.prepare("DELETE FROM knowledge_documents WHERE user_id = ?").run(userId);
      database.prepare("DELETE FROM workspaces WHERE user_id = ?").run(userId);
      database.prepare("DELETE FROM users WHERE id = ?").run(userId);
    })();
    database.close();
  }
}
