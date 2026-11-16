import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import Database from "better-sqlite3";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { userDirectToolIds } from "../src/lib/capability-catalog.mjs";
import { describeIncompleteCodeProjectFailure } from "../src/lib/project-output-failure.mjs";
import { buildWorkbenchHandoffResultMessage } from "../src/lib/supervisor-handoff-result.mjs";
import { classifyWorkbenchFailure, WORKBENCH_MAX_ATTEMPTS } from "../src/lib/workbench-retry.mjs";

const sourceProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vhfxnex-supervisor-api-"));
const projectRoot = path.join(tempRoot, "project");
const databasePath = path.join(tempRoot, "isolated.sqlite");
const distDirName = `.next-supervisor-api-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const sessionSecret = crypto.randomBytes(48).toString("base64url");
const testSecret = crypto.randomBytes(48).toString("base64url");
const addressServer = net.createServer();
let serverProcess;
let baseUrl;
let serverOutput = "";

const legacyMigrationDb = new Database(databasePath);
legacyMigrationDb.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, recovery_code_hash TEXT, role TEXT NOT NULL DEFAULT 'member',
    session_version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  INSERT INTO users (id, name, email, password_hash, created_at)
    VALUES ('legacy-migration-user', 'Legacy Fixture', 'legacy@example.test', 'fixture', '2026-11-15');
  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, category TEXT NOT NULL,
    body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  INSERT INTO workspaces (id, user_id, title, category, body, created_at, updated_at)
    VALUES ('legacy-migration-workspace', 'legacy-migration-user', 'Legacy Fixture', 'test', '{}', '2026-11-15', '2026-11-15');
  CREATE TABLE workbench_handoffs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
    instruction TEXT NOT NULL, user_message_id TEXT NOT NULL, user_message TEXT NOT NULL,
    attachments_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'cancelled')),
    claim_token TEXT, claim_expires_at INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  INSERT INTO workbench_handoffs (
    id, user_id, workspace_id, instruction, user_message_id, user_message,
    attachments_json, status, created_at, updated_at
  ) VALUES (
    'legacy-migration-handoff', 'legacy-migration-user', 'legacy-migration-workspace',
    'legacy instruction', 'legacy-message', 'legacy user message', '[]', 'pending',
    '2026-11-15', '2026-11-15'
  );
`);
legacyMigrationDb.close();

fs.cpSync(sourceProjectRoot, projectRoot, {
  recursive: true,
  filter(source) {
    if (source === sourceProjectRoot) return true;
    const relative = path.relative(sourceProjectRoot, source);
    const segments = relative.split(path.sep);
    if (
      relative === path.join("src", "instrumentation.ts") ||
      segments.some(
        (segment) =>
          segment === ".git" ||
          segment === "node_modules" ||
          segment === "deliverables" ||
          segment === "output" ||
          segment === "data" ||
          segment === "backups" ||
          segment === "coverage" ||
          segment === ".vercel" ||
          segment.startsWith(".next") ||
          segment === ".venv" ||
          segment === "venv",
      ) ||
      path.basename(source).startsWith(".env")
    )
      return false;
    return true;
  },
});
fs.symlinkSync(
  path.join(sourceProjectRoot, "node_modules"),
  path.join(projectRoot, "node_modules"),
  process.platform === "win32" ? "junction" : "dir",
);

function appendServerOutput(chunk) {
  serverOutput = `${serverOutput}${chunk}`.slice(-24_000);
}

async function getAvailablePort() {
  await new Promise((resolve, reject) => {
    addressServer.once("error", reject);
    addressServer.listen(0, "127.0.0.1", resolve);
  });
  const { port } = addressServer.address();
  await new Promise((resolve, reject) =>
    addressServer.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitForServer() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null || serverProcess.signalCode !== null) {
      throw new Error(`隔离 Next.js 服务提前退出。\n${serverOutput}`);
    }
    try {
      const response = await fetch(new URL("/api/auth/register", baseUrl), {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.status === 405) return;
      if (
        response.status >= 500 &&
        /(?:Module not found|Failed to compile|Unable to resolve)/iu.test(serverOutput)
      )
        throw new Error(`隔离 Next.js 服务编译失败。\n${serverOutput}`);
    } catch {
      // The dev compiler may need several seconds before the route is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`隔离 Next.js 服务启动超时。\n${serverOutput}`);
}

async function fetchJson(route, { method = "GET", body, cookie, headers = {} } = {}) {
  const requestHeaders = { Accept: "application/json", ...headers };
  requestHeaders["X-Forwarded-For"] ||= "198.51.100.77";
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
  if (cookie) requestHeaders.Cookie = cookie;
  const response = await fetch(new URL(route, baseUrl), {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

function parseSse(raw) {
  return raw
    .split(/\r?\n\r?\n/u)
    .filter(Boolean)
    .map((block) => {
      const data = block
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      return data ? JSON.parse(data) : null;
    })
    .filter(Boolean);
}

async function chat(
  cookie,
  scenario,
  question,
  workspaceId,
  modelWorkspaceId = workspaceId,
  directToolId = "pdf",
  attachments = [],
) {
  const response = await fetch(new URL("/api/chat", baseUrl), {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      Cookie: cookie,
      "X-Forwarded-For": "198.51.100.77",
      "x-vhfxnex-supervisor-test-secret": testSecret,
      "x-vhfxnex-supervisor-test-scenario": scenario,
      "x-vhfxnex-supervisor-test-tool": directToolId,
      ...(modelWorkspaceId ? { "x-vhfxnex-supervisor-test-workspace": modelWorkspaceId } : {}),
    },
    body: JSON.stringify({
      question,
      ...(workspaceId ? { workspaceId } : {}),
      ...(attachments.length ? { attachments } : {}),
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const body = await response.text();
    throw new Error(`管理员聊天未返回 SSE (${response.status})：${body}`);
  }
  return { response, events: parseSse(await response.text()) };
}

function testWorkspace() {
  const id = crypto.randomUUID();
  return {
    id,
    prompt: "模拟回归工作区",
    plan: {
      title: "模拟回归工作区",
      category: "软件项目",
      summary: "仅用于管理员 Agent API 路由回归。",
      constraints: [],
      routes: [
        {
          id: "route-main",
          title: "稳定路线",
          subtitle: "用于隔离 API 集成回归",
          fit: 88,
          reason: "仅验证交接事件与保存链路。",
          accent: "violet",
        },
      ],
      tasks: [],
      question: "",
      sources: [],
    },
    selectedRouteId: "route-main",
    result: null,
    conversation: [],
    createdAt: new Date().toISOString(),
    mode: "live",
  };
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null || serverProcess.signalCode !== null)
    return;
  serverProcess.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => serverProcess.once("close", resolve)),
    new Promise((resolve) => setTimeout(resolve, 8_000)),
  ]);
  if (serverProcess.exitCode === null && serverProcess.signalCode === null)
    serverProcess.kill("SIGKILL");
}

assert.equal(WORKBENCH_MAX_ATTEMPTS, 3);
assert.equal(classifyWorkbenchFailure({ status: 401 }).retryable, false);
assert.equal(classifyWorkbenchFailure({ status: 429 }).retryable, true);
assert.equal(classifyWorkbenchFailure({ status: 503 }).retryable, true);
assert.equal(classifyWorkbenchFailure({ error: new TypeError("fetch failed") }).retryable, true);
assert.equal(
  classifyWorkbenchFailure({ error: new Error("SqliteError: database table is locked") }).retryable,
  true,
);
assert.equal(classifyWorkbenchFailure({ error: new Error("SQLITE_FULL") }).retryable, false);
assert.equal(classifyWorkbenchFailure({ error: new Error("参数格式无效") }).retryable, false);
assert.equal(
  classifyWorkbenchFailure({ error: new Error("Agent 未生成可下载的代码项目") }).maxAttempts,
  2,
);
const incompleteUpdateMessage = describeIncompleteCodeProjectFailure({
  intent: "update",
  existingProjectTitle: "VHFXNEX 桌面计时器 v1.0 完整源码",
  hasExistingProject: true,
  draftFileCount: 5,
});
assert.match(incompleteUpdateMessage, /旧版本.*仍可下载/u);
assert.match(incompleteUpdateMessage, /已暂存 5 个文件改动/u);
assert.equal(
  classifyWorkbenchFailure({ error: new Error(incompleteUpdateMessage) }).maxAttempts,
  2,
);
const incompleteNewProjectMessage = describeIncompleteCodeProjectFailure({
  intent: "create",
  existingProjectTitle: "VHFXNEX 桌面计时器 v1.0 完整源码",
  hasExistingProject: true,
});
assert.match(incompleteNewProjectMessage, /本轮未能生成新的可下载代码项目/u);
assert.equal(
  classifyWorkbenchFailure({ error: new Error(incompleteNewProjectMessage) }).maxAttempts,
  2,
);
assert.equal(
  classifyWorkbenchFailure({
    error: new Error("Agent 未能完成任务、时间线、行动方案、可运行代码项目，请重试。"),
  }).maxAttempts,
  2,
);
assert.equal(
  classifyWorkbenchFailure({ error: new Error("Agent 未能完成行动方案，请重试") }).retryable,
  true,
);
assert.equal(
  classifyWorkbenchFailure({ error: new Error("Agent 未能补齐必需产物，请重试") }).maxAttempts,
  2,
);
assert.equal(
  classifyWorkbenchFailure({
    error: new Error("AI_NoOutputGeneratedError: did not contain a call to the required tool"),
  }).retryable,
  true,
);
assert.match(
  buildWorkbenchHandoffResultMessage({
    workspaceTitle: "回归项目",
    outcome: "failed",
    summary: "鉴权失败，已停止自动重试。",
    completedTasks: 0,
    totalTasks: 2,
    artifactTitles: [],
  }),
  /执行失败，系统已停止自动重试/u,
);

try {
  const port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const childEnv = {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    GOALFLOW_DATABASE_PATH: databasePath,
    SESSION_SECRET: sessionSecret,
    NEXORA_DISABLE_AI: "1",
    DEEPSEEK_API_KEY: "",
    NEXORA_ENABLE_SUPERVISOR_MODEL_TEST: "1",
    NEXORA_SUPERVISOR_MODEL_TEST_SECRET: testSecret,
    NEXORA_NEXT_DIST_DIR: distDirName,
    NODE_OPTIONS: [
      process.env.NODE_OPTIONS?.trim(),
      "--preserve-symlinks",
      "--preserve-symlinks-main",
    ]
      .filter(Boolean)
      .join(" "),
  };
  serverProcess = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { cwd: projectRoot, env: childEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  serverProcess.stdout.on("data", appendServerOutput);
  serverProcess.stderr.on("data", appendServerOutput);
  await waitForServer();
  assert.ok(
    !serverOutput.includes(".env.local"),
    "the isolated API check must not load the user's .env.local",
  );
  const migrationDb = new Database(databasePath, { readonly: true });
  try {
    const schema = migrationDb
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'workbench_handoffs'")
      .get().sql;
    const migratedLegacyHandoff = migrationDb
      .prepare(
        "SELECT status, origin_scope, attempt_count FROM workbench_handoffs WHERE id = 'legacy-migration-handoff'",
      )
      .get();
    assert.match(schema, /'failed'/u, "legacy queue schema should gain a terminal failure status");
    assert.deepEqual(migratedLegacyHandoff, {
      status: "pending",
      origin_scope: "workspace",
      attempt_count: 0,
    });
  } finally {
    migrationDb.close();
  }

  const registration = await fetchJson("/api/auth/register", {
    method: "POST",
    body: {
      name: "模拟测试用户",
      email: `supervisor-api-${crypto.randomUUID()}@example.test`,
      password: crypto.randomBytes(24).toString("base64url"),
    },
  });
  assert.equal(registration.response.status, 200, JSON.stringify(registration.payload));
  const setCookies = registration.response.headers.getSetCookie?.() || [
    registration.response.headers.get("set-cookie") || "",
  ];
  const cookie = setCookies
    .map((value) => value.split(";")[0])
    .filter(Boolean)
    .join("; ");
  assert.ok(cookie, "registration should establish an authenticated session");

  const workspace = testWorkspace();
  const savedWorkspace = await fetchJson("/api/workspaces", {
    method: "POST",
    cookie,
    body: { workspace },
  });
  assert.equal(savedWorkspace.response.status, 200, JSON.stringify(savedWorkspace.payload));

  const incompleteProject = await fetchJson("/api/tools/validate-project", {
    method: "POST",
    cookie,
    body: { files: [{ path: "src/app.js", content: 'console.log("missing entry");' }] },
  });
  assert.equal(incompleteProject.response.status, 200, JSON.stringify(incompleteProject.payload));
  assert.match(incompleteProject.payload?.issues?.join(" ") || "", /README\.md/u);
  assert.match(incompleteProject.payload?.issues?.join(" ") || "", /可运行入口/u);

  const completeProject = await fetchJson("/api/tools/validate-project", {
    method: "POST",
    cookie,
    body: {
      files: [
        { path: "README.md", content: "# Smoke\n\n直接打开 index.html 运行。" },
        { path: "index.html", content: "<!doctype html><h1>Smoke</h1>" },
      ],
    },
  });
  assert.equal(completeProject.response.status, 200, JSON.stringify(completeProject.payload));
  assert.deepEqual(completeProject.payload?.issues, []);

  const invalidGate = await fetchJson("/api/chat", {
    method: "POST",
    cookie,
    body: { question: "跟我聊聊接下来怎么安排项目。" },
    headers: {
      "x-vhfxnex-supervisor-test-secret": "invalid-test-secret",
      "x-vhfxnex-supervisor-test-scenario": "reply",
    },
  });
  assert.equal(
    invalidGate.response.status,
    503,
    "an invalid test secret must not enable the mock model",
  );
  assert.match(invalidGate.payload?.error || "", /API Key/u);

  const reply = await chat(cookie, "reply", "跟我聊聊接下来怎么安排项目。");
  assert.deepEqual(
    reply.events.filter((event) => event.type === "text").map((event) => event.text),
    ["模拟模型已通过管理员 API ", "流式回复。"],
  );
  assert.equal(
    reply.events.find((event) => event.type === "result")?.data?.answer,
    "模拟模型已通过管理员 API 流式回复。",
  );

  for (const toolId of userDirectToolIds) {
    const openTool = await chat(
      cookie,
      "open-user-tool",
      `请打开 ${toolId} 工具，准备开始操作。`,
      undefined,
      undefined,
      toolId,
    );
    assert.ok(
      openTool.events.some((event) => event.type === "launch_tool" && event.tool === toolId),
      `管理员未能将 ${toolId} 工具 ID 分流到前端：${JSON.stringify(openTool.events)}`,
    );
    assert.ok(
      openTool.events.some(
        (event) => event.type === "launch_tool" && event.instruction.includes(toolId),
      ),
      `管理员分流 ${toolId} 时未保留用户指令。`,
    );
  }

  const newGoal = await chat(cookie, "new-goal", "我们来讨论一下最近的安排。");
  assert.ok(
    newGoal.events.some(
      (event) => event.type === "start_new_goal" && /模拟回归新目标/u.test(event.prompt),
    ),
  );

  const search = await chat(cookie, "search", "我想了解这个行业的发展情况，先讨论下资料来源。");
  assert.deepEqual(
    search.events.filter((event) => event.type === "status").map((event) => event.message),
    ["正在联网检索公开来源…", "已收到网页来源，正在整理结论…"],
  );
  assert.ok(
    search.events.some(
      (event) => event.type === "text" && event.text.includes("example.test/supervisor-search"),
    ),
  );

  const handoff = await chat(
    cookie,
    "handoff",
    "我们来聊聊这个软件项目接下来怎么安排。",
    workspace.id,
  );
  const handoffEvent = handoff.events.find((event) => event.type === "handoff");
  assert.ok(
    handoffEvent,
    `expected a saved handoff event; received: ${JSON.stringify(handoff.events)}`,
  );
  assert.equal(handoffEvent?.workspaceId, workspace.id);
  assert.match(handoffEvent?.instruction || "", /模拟模型通过管理员发起/u);
  const queued = await fetchJson("/api/handoffs", { cookie });
  assert.equal(queued.response.status, 200);
  assert.ok(queued.payload?.handoffs?.some((item) => item.id === handoffEvent.handoffId));

  const originalRequest =
    "请严格按附件中的标题和版式完成活动策划，只替换正文内容，并交付可下载文件。";
  const modelRoutedRequest = "我已经选好路线，请把活动策划交给工作台完成，模板在附件。";
  const referenceAttachment = {
    name: "活动格式参考.md",
    mimeType: "text/markdown",
    kind: "text",
    content: "# 活动策划书\n\n## 一、活动主题\n\n保留标题，替换内容。",
  };
  const recoveredHandoff = await chat(
    cookie,
    "handoff-invalid",
    modelRoutedRequest,
    workspace.id,
    workspace.id,
    "pdf",
    [referenceAttachment],
  );
  assert.ok(
    recoveredHandoff.events.some(
      (event) =>
        event.type === "status" && /按当前工作区和你的原始要求继续交接/u.test(event.message),
    ),
    `invalid tool arguments should recover using the original request: ${JSON.stringify(recoveredHandoff.events)}`,
  );
  const recoveredEvent = recoveredHandoff.events.find((event) => event.type === "handoff");
  assert.ok(
    recoveredEvent,
    `expected invalid handoff recovery to enqueue a job: ${JSON.stringify(recoveredHandoff.events)}`,
  );
  assert.equal(recoveredEvent?.workspaceId, workspace.id);
  const recoveredDb = new Database(databasePath, { readonly: true });
  try {
    const recoveredRow = recoveredDb
      .prepare("SELECT instruction, attachments_json, status FROM workbench_handoffs WHERE id = ?")
      .get(recoveredEvent.handoffId);
    assert.equal(recoveredRow?.instruction, modelRoutedRequest);
    assert.equal(recoveredRow?.status, "pending");
    const savedAttachments = JSON.parse(recoveredRow?.attachments_json || "[]");
    assert.deepEqual(
      savedAttachments.map(({ name, content }) => ({ name, content })),
      [{ name: referenceAttachment.name, content: referenceAttachment.content }],
    );
  } finally {
    recoveredDb.close();
  }
  const recoveredClaim = await fetchJson("/api/handoffs", {
    method: "PATCH",
    cookie,
    body: { action: "claim", id: recoveredEvent.handoffId },
  });
  assert.equal(recoveredClaim.payload?.status, "claimed");
  const recoveredCancellation = await fetchJson("/api/handoffs", {
    method: "PATCH",
    cookie,
    body: {
      action: "cancel",
      id: recoveredEvent.handoffId,
      token: recoveredClaim.payload.token,
    },
  });
  assert.deepEqual(recoveredCancellation.payload, { ok: true });

  const workspaceHandoffClaim = await fetchJson("/api/handoffs", {
    method: "PATCH",
    cookie,
    body: { action: "claim", id: handoffEvent.handoffId },
  });
  assert.equal(workspaceHandoffClaim.payload?.status, "claimed");
  const retryScheduled = await fetchJson("/api/handoffs", {
    method: "PATCH",
    cookie,
    body: {
      action: "release",
      id: handoffEvent.handoffId,
      token: workspaceHandoffClaim.payload.token,
      retryable: true,
      retryAfterMs: 60_000,
      maxAttempts: 2,
      lastError: "模拟限流",
    },
  });
  assert.deepEqual(retryScheduled.payload, { ok: true, status: "retry" });
  const delayedClaim = await fetchJson("/api/handoffs", {
    method: "PATCH",
    cookie,
    body: { action: "claim", id: handoffEvent.handoffId },
  });
  assert.equal(delayedClaim.payload?.status, "delayed");
  assert.ok(delayedClaim.payload?.retryAfterMs > 0);
  const retryDb = new Database(databasePath);
  try {
    retryDb
      .prepare("UPDATE workbench_handoffs SET next_attempt_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1_000).toISOString(), handoffEvent.handoffId);
  } finally {
    retryDb.close();
  }
  const secondWorkspaceHandoffClaim = await fetchJson("/api/handoffs", {
    method: "PATCH",
    cookie,
    body: { action: "claim", id: handoffEvent.handoffId },
  });
  assert.equal(secondWorkspaceHandoffClaim.payload?.status, "claimed");
  const permanentFailure = await fetchJson("/api/handoffs", {
    method: "PATCH",
    cookie,
    body: {
      action: "release",
      id: handoffEvent.handoffId,
      token: secondWorkspaceHandoffClaim.payload.token,
      retryable: true,
      retryAfterMs: 15_000,
      maxAttempts: 2,
      lastError: "模拟交付物未生成",
    },
  });
  assert.deepEqual(permanentFailure.payload, { ok: true, status: "failed" });
  const failedHandoffDb = new Database(databasePath, { readonly: true });
  try {
    assert.deepEqual(
      failedHandoffDb
        .prepare("SELECT status, attachments_json FROM workbench_handoffs WHERE id = ?")
        .get(handoffEvent.handoffId),
      { status: "failed", attachments_json: "[]" },
    );
  } finally {
    failedHandoffDb.close();
  }
  const updatedWorkspace = await fetchJson(`/api/workspaces/${workspace.id}`, { cookie });
  assert.ok(
    updatedWorkspace.payload?.workspace?.conversation?.some(
      (item) => item.role === "assistant" && /工作台 Agent 连续处理/u.test(item.content),
    ),
  );

  const globalHandoffQuestion = "请继续推进这个软件项目，并把最终成果带回总控对话。";
  const rateLimitDb = new Database(databasePath);
  try {
    // Keep the two handoff-scope checks independent of earlier API cases in this isolated run.
    rateLimitDb.prepare("DELETE FROM auth_rate_limits").run();
  } finally {
    rateLimitDb.close();
  }
  const explicitAttachmentHandoff = await chat(
    cookie,
    "reply",
    originalRequest,
    workspace.id,
    workspace.id,
    "pdf",
    [referenceAttachment],
  );
  const explicitHandoffEvent = explicitAttachmentHandoff.events.find(
    (event) => event.type === "handoff",
  );
  assert.ok(
    explicitHandoffEvent,
    `clear work requests with attachments should route without a model intent call: ${JSON.stringify(explicitAttachmentHandoff.events)}`,
  );
  const explicitHandoffDb = new Database(databasePath, { readonly: true });
  try {
    const explicitHandoffRow = explicitHandoffDb
      .prepare("SELECT instruction, attachments_json FROM workbench_handoffs WHERE id = ?")
      .get(explicitHandoffEvent.handoffId);
    assert.equal(explicitHandoffRow?.instruction, originalRequest);
    assert.deepEqual(
      JSON.parse(explicitHandoffRow?.attachments_json || "[]").map(({ name, content }) => ({
        name,
        content,
      })),
      [{ name: referenceAttachment.name, content: referenceAttachment.content }],
      "direct task routing must preserve the attached template for the workbench agent",
    );
  } finally {
    explicitHandoffDb.close();
  }
  const explicitHandoffClaim = await fetchJson("/api/handoffs", {
    method: "PATCH",
    cookie,
    body: { action: "claim", id: explicitHandoffEvent.handoffId },
  });
  assert.equal(explicitHandoffClaim.payload?.status, "claimed");
  const explicitHandoffCancellation = await fetchJson("/api/handoffs", {
    method: "PATCH",
    cookie,
    body: {
      action: "cancel",
      id: explicitHandoffEvent.handoffId,
      token: explicitHandoffClaim.payload.token,
    },
  });
  assert.deepEqual(explicitHandoffCancellation.payload, { ok: true });
  const globalHandoff = await chat(
    cookie,
    "handoff",
    globalHandoffQuestion,
    undefined,
    workspace.id,
  );
  const globalHandoffEvent = globalHandoff.events.find((event) => event.type === "handoff");
  assert.ok(
    globalHandoffEvent,
    `expected a global supervisor handoff; received: ${JSON.stringify(globalHandoff.events)}`,
  );
  const handoffDb = new Database(databasePath, { readonly: true });
  try {
    const origins = handoffDb
      .prepare("SELECT user_message_id, origin_scope FROM workbench_handoffs ORDER BY created_at")
      .all();
    const originByMessageId = new Map(
      origins.map((item) => [item.user_message_id, item.origin_scope]),
    );
    assert.equal(originByMessageId.get(handoffEvent.userMessageId), "workspace");
    assert.equal(originByMessageId.get(globalHandoffEvent.userMessageId), "global");
  } finally {
    handoffDb.close();
  }
  const globalHandoffClaim = await fetchJson("/api/handoffs", {
    method: "PATCH",
    cookie,
    body: { action: "claim", id: globalHandoffEvent.handoffId },
  });
  assert.equal(globalHandoffClaim.payload?.status, "claimed");
  const attemptLimitDb = new Database(databasePath);
  try {
    attemptLimitDb
      .prepare("UPDATE workbench_handoffs SET attempt_count = 3 WHERE id = ?")
      .run(globalHandoffEvent.handoffId);
  } finally {
    attemptLimitDb.close();
  }
  const exhaustedHandoff = await fetchJson("/api/handoffs", {
    method: "PATCH",
    cookie,
    body: {
      action: "release",
      id: globalHandoffEvent.handoffId,
      token: globalHandoffClaim.payload.token,
      retryable: true,
      lastError: "模拟重试次数耗尽",
    },
  });
  assert.deepEqual(exhaustedHandoff.payload, { ok: true, status: "failed" });

  const unauthorized = await chat(
    cookie,
    "handoff-unauthorized",
    "我们继续聊聊软件项目接下来怎么安排。",
    undefined,
    crypto.randomUUID(),
  );
  assert.ok(
    unauthorized.events.some(
      (event) => event.type === "error" && /不存在或你没有访问权限/u.test(event.error),
    ),
  );
  const queueAfterUnauthorized = await fetchJson("/api/handoffs", { cookie });
  assert.equal(
    queueAfterUnauthorized.payload?.handoffs?.length,
    0,
    "a forged workspace handoff must not be queued",
  );

  const conversation = await fetchJson("/api/supervisor/conversation", { cookie });
  const savedGlobalMessages = conversation.payload?.messages || [];
  assert.ok(
    savedGlobalMessages.some(
      (item) => item.role === "assistant" && item.content === "模拟模型已通过管理员 API 流式回复。",
    ),
  );
  assert.ok(
    savedGlobalMessages.some(
      (item) => item.role === "assistant" && /PDF 工具箱/u.test(item.content),
    ),
  );
  assert.ok(
    savedGlobalMessages.some((item) => item.role === "assistant" && /规划器/u.test(item.content)),
  );
  assert.ok(
    savedGlobalMessages.some(
      (item) => item.role === "user" && item.content === globalHandoffQuestion,
    ),
    "a global handoff should remain in the manager conversation while the workbench runs",
  );

  console.log(
    "✓ Isolated API smoke passed legacy queue migration, bounded handoff retries, permanent-failure handling, complete-project gating, mock supervisor replies, malformed-handoff recovery with attachment persistence, global persistence, direct-tool dispatch, new-goal dispatch, fixture search, invalid-secret gate, and workspace-access rejection without provider calls.",
  );
} catch (error) {
  if (serverOutput.trim()) console.error(`\n隔离服务日志：\n${serverOutput}`);
  throw error;
} finally {
  await stopServer();
  const resolvedTempRoot = path.resolve(tempRoot);
  const tempParent = path.resolve(os.tmpdir());
  const relativeTempRoot = path.relative(tempParent, resolvedTempRoot);
  if (
    path.basename(resolvedTempRoot).startsWith("vhfxnex-supervisor-api-") &&
    relativeTempRoot &&
    !relativeTempRoot.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativeTempRoot)
  )
    fs.rmSync(resolvedTempRoot, { recursive: true, force: true });
}
