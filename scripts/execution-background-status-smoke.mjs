import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { chromium } from "playwright-core";
import { resolveDatabasePath } from "../src/lib/database-path.mjs";
import {
  assertSmokeTargetMatchesDatabaseOrExit,
  loadSmokeEnvironmentOrExit,
} from "./smoke-environment.mjs";

loadSmokeEnvironmentOrExit();

const baseUrl = new URL(process.env.NEXORA_BASE_URL || "http://localhost:3000");
if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(baseUrl.hostname))
  throw new Error("This regression check only runs against a local VHFXNEX server.");
await assertSmokeTargetMatchesDatabaseOrExit(baseUrl);

const executablePath = [
  process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  process.env.PROGRAMFILES &&
    path.join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
  process.env["PROGRAMFILES(X86)"] &&
    path.join(process.env["PROGRAMFILES(X86)"], "Google/Chrome/Application/chrome.exe"),
].find((candidate) => candidate && fs.existsSync(candidate));
if (!executablePath)
  throw new Error(
    "Chrome was not found. Set PLAYWRIGHT_EXECUTABLE_PATH to a local Chrome/Chromium executable.",
  );

const suffix = crypto.randomUUID();
const name = "VHFXNEX 状态回归";
const email = `nexora-execution-smoke-${suffix}@example.test`;
const password = crypto.randomBytes(24).toString("base64url");
const database = new Database(resolveDatabasePath());
const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(baseUrl.href, { waitUntil: "networkidle" });
  await page.getByPlaceholder("例如：星云").fill(name);
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("至少 8 位字符").fill(password);
  await page.getByPlaceholder("再输入一次密码").fill(password);
  await page.getByRole("button", { name: "创建空间" }).click();
  const recoveryDialog = page.getByRole("dialog", { name: "先保存账户恢复码" });
  await recoveryDialog.waitFor();
  await recoveryDialog.getByLabel("我已将恢复码保存在安全位置").check();
  await recoveryDialog.getByRole("button", { name: "进入我的空间" }).click();
  await page.locator(".home-primary").waitFor({ state: "visible" });

  const prompt = "创建一个可下载运行的桌面计时器项目";
  const planResponse = await page.evaluate(async (goal) => {
    const response = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: goal, demo: true, thinkingMode: "deep" }),
    });
    return { status: response.status, ...(await response.json()) };
  }, prompt);
  assert.equal(planResponse.status, 200);
  const workspaceId = crypto.randomUUID();
  const workspace = {
    id: workspaceId,
    prompt,
    plan: planResponse.plan,
    selectedRouteId: planResponse.plan.routes[0].id,
    result: null,
    conversation: [
      { id: crypto.randomUUID(), role: "user", content: prompt },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        agent: "planner",
        content: planResponse.plan.summary,
      },
    ],
    createdAt: new Date().toISOString(),
    mode: "live",
  };
  const saveResponse = await page.evaluate(async (value) => {
    const response = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: value }),
    });
    return { status: response.status, ...(await response.json()) };
  }, workspace);
  assert.equal(saveResponse.status, 200, saveResponse.error || "workspace save failed");

  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".home-primary").waitFor({ state: "visible" });
  await page.getByRole("button", { name: /我的目标/ }).click();
  const workspaceCard = page
    .locator(".history-grid article")
    .filter({ hasText: planResponse.plan.title });
  await workspaceCard.waitFor({ state: "visible" });
  await workspaceCard.locator(".history-card-open").click();
  await page.locator("#workspace-chat-input").waitFor({ state: "visible" });

  const userId = database.prepare("SELECT id FROM users WHERE email = ?").get(email)?.id;
  assert.ok(userId, "registered user must have a local database row");
  const observedRecoveryResponses = [];
  page.on("response", async (response) => {
    if (
      response.url().endsWith("/api/executions") ||
      response.url().endsWith(`/api/workspaces/${workspaceId}`)
    ) {
      observedRecoveryResponses.push({
        url: new URL(response.url()).pathname,
        status: response.status(),
        body: await response.json().catch(() => null),
      });
    }
  });
  let executionToken;
  await page.route("**/api/execute", async (route) => {
    const body = route.request().postDataJSON();
    if (body.workspaceId !== workspaceId) return route.continue();
    executionToken = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    database
      .prepare(
        "INSERT INTO workspace_execution_locks (workspace_id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
      )
      .run(workspaceId, userId, executionToken, Date.now() + 60_000);
    database
      .prepare(
        `INSERT INTO workspace_execution_status
          (token, workspace_id, user_id, workspace_title, state, activity, completed_tool_calls,
           message, started_at, updated_at, finished_at)
         VALUES (?, ?, ?, ?, 'running', ?, 2, NULL, ?, ?, NULL)`,
      )
      .run(
        executionToken,
        workspaceId,
        userId,
        planResponse.plan.title,
        "正在生成代码交付物",
        startedAt,
        startedAt,
      );
    await route.abort("connectionreset");
  });
  await page.getByRole("button", { name: "开始全程执行" }).click();
  try {
    await page.waitForFunction(
      () =>
        document
          .querySelector(".workspace-live-progress.running")
          ?.textContent?.includes("正在生成代码交付物") &&
        document
          .querySelector(".workspace-live-progress.running")
          ?.textContent?.includes("已完成 2 项工具操作"),
    );
  } catch (error) {
    console.error(
      "Disconnected execution status diagnostics:",
      JSON.stringify({
        progress: await page.locator(".workspace-live-progress").allTextContents(),
        topbar: await page.locator(".topbar-execution-chip").allTextContents(),
        error: await page.locator(".chat-error, .error-banner").allTextContents(),
        observedRecoveryResponses,
        body: (await page.locator("body").innerText()).slice(-2500),
      }),
    );
    throw error;
  }
  assert.equal(await page.locator(".workspace-live-progress.failed").count(), 0);

  const row = database.prepare("SELECT body FROM workspaces WHERE id = ?").get(workspaceId);
  const completedWorkspace = JSON.parse(row.body);
  completedWorkspace.result = {
    summary: "后台成果已同步：本轮代码已生成。",
    tasks: planResponse.plan.tasks,
    milestones: [],
    artifacts: [
      {
        id: "execution-status-smoke-code",
        type: "code",
        title: "计时器源代码",
        description: "由后台任务完成并自动同步。",
        content: "包含计时器核心逻辑的项目文件。",
        files: [{ path: "src/timer.ts", content: "export const ready = true;" }],
      },
    ],
    events: [
      {
        id: "execution-status-smoke-event",
        name: "draft_document",
        title: "代码交付物已生成",
        detail: "后台任务已完成并保存成果。",
        status: "done",
      },
    ],
  };
  completedWorkspace.conversation = [
    ...completedWorkspace.conversation,
    {
      id: crypto.randomUUID(),
      role: "assistant",
      agent: "workbench",
      content: completedWorkspace.result.summary,
    },
  ];
  const completedAt = new Date(Date.now() + 1_000).toISOString();
  database
    .prepare("UPDATE workspaces SET body = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(completedWorkspace), completedAt, workspaceId);
  database
    .prepare(
      "UPDATE workspace_execution_status SET state = 'completed', activity = ?, message = ?, completed_tool_calls = 3, updated_at = ?, finished_at = ? WHERE token = ?",
    )
    .run(
      "本轮执行已完成",
      completedWorkspace.result.summary,
      completedAt,
      completedAt,
      executionToken,
    );
  database
    .prepare("DELETE FROM workspace_execution_locks WHERE workspace_id = ? AND token = ?")
    .run(workspaceId, executionToken);

  await page
    .locator(".workspace-live-progress.completed")
    .getByText(/本轮执行完成 · 共完成 3 项工具操作/)
    .waitFor({ state: "visible" });
  try {
    await page
      .locator(".workspace-chat-thread")
      .getByText("后台成果已同步：本轮代码已生成。", { exact: true })
      .first()
      .waitFor({ state: "visible" });
  } catch (error) {
    console.error(
      "Completed execution recovery diagnostics:",
      JSON.stringify({
        progress: await page.locator(".workspace-live-progress").allTextContents(),
        chat: await page
          .locator(".workspace-chat-thread")
          .innerText()
          .catch(() => ""),
        observedRecoveryResponses,
      }),
    );
    throw error;
  }
  await page.waitForTimeout(3_000);
  await page
    .locator(".workspace-live-progress.completed")
    .getByText(/本轮执行完成 · 共完成 3 项工具操作/)
    .waitFor({ state: "visible" });
  assert.equal(await page.locator(".workspace-live-progress.running").count(), 0);
  console.log(
    "PASS: preserve the server-confirmed running state after a browser disconnect, then sync the final workspace result and artifacts.",
  );

  await page.unroute("**/api/execute");
  await page.evaluate(
    async (id) => fetch(`/api/workspaces/${id}`, { method: "DELETE" }),
    workspaceId,
  );
  await context.close();
} finally {
  await browser.close();
  database.close();
}
