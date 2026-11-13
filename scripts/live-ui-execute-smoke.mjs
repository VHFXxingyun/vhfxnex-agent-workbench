import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import JSZip from "jszip";
import { chromium } from "playwright-core";
import { resolveDatabasePath } from "../src/lib/database-path.mjs";
import { loadSmokeEnvironment } from "./smoke-environment.mjs";

loadSmokeEnvironment();
const baseUrl = new URL(process.env.NEXORA_BASE_URL || "http://localhost:3000");
if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(baseUrl.hostname)) {
  throw new Error("The live browser smoke check only runs against a local NEXORA server.");
}

const chromeCandidates = [
  process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  process.env.PROGRAMFILES &&
    path.join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
  process.env["PROGRAMFILES(X86)"] &&
    path.join(process.env["PROGRAMFILES(X86)"], "Google/Chrome/Application/chrome.exe"),
].filter(Boolean);
const executablePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
if (!executablePath) {
  throw new Error(
    "Chrome was not found. Set PLAYWRIGHT_EXECUTABLE_PATH to a local Chrome/Chromium executable.",
  );
}

const address = `198.51.100.${crypto.randomInt(1, 255)}`;
const suffix = crypto.randomUUID();
const email = `nexora-live-ui-${suffix}@example.test`;
const password = crypto.randomBytes(24).toString("base64url");
const prompt =
  "请为大学生周末旧物交换市集直接创建一个可运行的报名网页演示，不要只给计划；同时生成落地执行方案、任务清单和两周时间线。";
let browser;
let userId;
let workspaceId;
let page;
let database;

try {
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    extraHTTPHeaders: { "X-Forwarded-For": address },
  });
  page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(baseUrl.href, { waitUntil: "domcontentloaded" });
  const registration = await page.evaluate(
    async ({ name, email, password }) => {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      return { status: response.status, payload: await response.json() };
    },
    { name: "Live UI Smoke", email, password },
  );
  assert.equal(registration.status, 200, registration.payload?.error || "registration failed");
  userId = registration.payload?.user?.id;
  assert.ok(userId);

  await page.reload({ waitUntil: "domcontentloaded" });
  const account = await page.evaluate(async () => {
    const response = await fetch("/api/auth/me");
    return response.json();
  });
  assert.equal(account.user?.id, userId, "the browser must retain the new session cookie");
  assert.equal(account.aiConfigured, true, "a server-side DeepSeek key is required for this check");
  await page.getByRole("button", { name: "开始探索" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "切换演示模式" }).isVisible(), true);

  await page.route("**/api/plan", async (route) => {
    if (route.request().method() === "POST") {
      workspaceId = route.request().postDataJSON()?.workspaceId;
    }
    await route.continue();
  });
  await page.getByRole("textbox", { name: "描述你想完成的目标" }).fill(prompt);
  await page.getByRole("button", { name: "开始探索" }).click();
  await page.locator(".chat-route-option").first().waitFor({ timeout: 210_000 });
  assert.match(await page.locator(".goal-strip").innerText(), /实时 AI/);
  assert.match(workspaceId || "", /^[0-9a-f-]{36}$/i);

  const executionResponsePromise = page
    .waitForResponse((response) => new URL(response.url()).pathname === "/api/execute", {
      timeout: 210_000,
    })
    .catch((error) => ({ waitError: error.message }));
  await page.getByRole("button", { name: "开始全程执行" }).click();
  await page.locator(".workspace-live-progress.running").waitFor({ timeout: 210_000 });
  const responseOutcome = await Promise.race([
    page
      .locator(".chat-live-response")
      .waitFor({ state: "visible", timeout: 210_000 })
      .then(() => ({ ready: true, error: "" })),
    page
      .locator(".workspace-chat .chat-error")
      .waitFor({ state: "visible", timeout: 210_000 })
      .then(async () => ({
        ready: false,
        error: (await page.locator(".workspace-chat .chat-error").innerText()).trim(),
      })),
  ]);
  assert.equal(
    responseOutcome.ready,
    true,
    `The live Agent must continue after its first tool call: ${responseOutcome.error}`,
  );
  await page.waitForFunction(
    async (id) => {
      const response = await fetch(`/api/workspaces/${id}`, { cache: "no-store" });
      if (!response.ok) return false;
      const payload = await response.json();
      return /已保存\s+\d+\s+项阶段成果/.test(payload.workspace?.result?.summary || "");
    },
    workspaceId,
    { timeout: 210_000 },
  );
  const liveNarration = page.locator(".chat-live-text");
  await liveNarration.waitFor({ state: "visible" });
  assert.match(await liveNarration.innerText(), /我先|我正在|接着/);
  const response = await executionResponsePromise;
  assert.ok(!("waitError" in response), response.waitError || "Agent response was not observed");
  assert.equal(response.status(), 200);
  assert.match(response.headers()["content-type"] || "", /text\/event-stream/i);
  await page.waitForFunction(
    () =>
      !document.querySelector('.workspace-chat-head [aria-label="Agent 正在运行"]') &&
      !document.querySelector(".chat-live-response"),
    null,
    { timeout: 600_000 },
  );
  const chatError = await page
    .locator(".workspace-chat .chat-error")
    .textContent()
    .catch(() => null);
  assert.equal(chatError, null, `The live Agent must finish without an error: ${chatError || ""}`);
  const finalAssistantMessage = page.locator(".workspace-chat-thread .chat-agent").last();
  await finalAssistantMessage.waitFor({ state: "visible" });
  assert.ok((await finalAssistantMessage.innerText()).trim().length > 0);

  const workspaceResponse = await page.evaluate(async (id) => {
    const response = await fetch(`/api/workspaces/${id}`);
    return { status: response.status, payload: await response.json() };
  }, workspaceId);
  assert.equal(workspaceResponse.status, 200);
  const saved = workspaceResponse.payload?.workspace;
  assert.ok(
    saved?.result?.events?.length,
    "the live result must persist in the signed-in workspace",
  );
  assert.ok(saved.usage?.totalTokens > 0, "the workspace must store provider-reported usage");
  const codeArtifact = saved.result.artifacts.find((artifact) => artifact.type === "code");
  assert.ok(codeArtifact, "the explicit website request must produce a code project artifact");
  assert.ok(codeArtifact.files?.length, "the code artifact must contain real project files");
  const projectFiles = new Map(codeArtifact.files.map((file) => [file.path, file.content]));
  assert.ok(projectFiles.has("README.md"), "the generated project must include setup instructions");
  assert.ok(
    [...projectFiles.keys()].some((file) => file === "index.html" || file === "package.json"),
    "the generated project must include a runnable entry point",
  );
  assert.ok(
    saved.conversation?.some(
      (message) => message.role === "assistant" && message.toolEvents?.length,
    ),
    "completed Agent tool calls must remain in the saved conversation record",
  );

  const toolNames = [...new Set(saved.result.events.map((event) => event.name))];
  const executionUsage = saved.result.usage;
  assert.ok(executionUsage?.totalTokens > 0, "execution usage must be available separately");
  assert.ok(toolNames.includes("create_project"), "the live tool stream must show create_project");
  const artifactShelf = page.locator(".chat-artifact-shelf");
  await artifactShelf.locator("summary").click();
  await artifactShelf
    .locator(".chat-artifact-card")
    .filter({ hasText: codeArtifact.title })
    .click();
  const artifactDialog = page.getByRole("dialog");
  await artifactDialog.waitFor({ state: "visible" });
  const projectDownloadPromise = page.waitForEvent("download", { timeout: 15_000 });
  await artifactDialog.getByRole("button", { name: "下载 ZIP 项目" }).click();
  const projectDownload = await projectDownloadPromise;
  assert.match(projectDownload.suggestedFilename(), /\.zip$/);
  const projectArchive = await JSZip.loadAsync(fs.readFileSync(await projectDownload.path()), {
    checkCRC32: true,
  });
  for (const [filePath, content] of projectFiles) {
    assert.equal(
      await projectArchive.file(filePath)?.async("string"),
      content,
      "the downloaded project must contain " + filePath,
    );
  }
  await artifactDialog.getByRole("button", { name: "关闭产物" }).click();
  console.log(
    `✓ Browser executed DeepSeek SSE in real time: ${toolNames.join(", ")}; ` +
      `visible streamed narration; ` +
      `${saved.usage.totalTokens} total tokens ` +
      `(planning ${saved.usage.totalTokens - executionUsage.totalTokens}, ` +
      `execution ${executionUsage.totalTokens}; ` +
      `${executionUsage.inputTokens} input / ${executionUsage.outputTokens} output).`,
  );
} finally {
  if (page && workspaceId) {
    await page
      .evaluate(async (id) => {
        await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
      }, workspaceId)
      .catch(() => {});
  }
  await browser?.close();
  database = new Database(resolveDatabasePath(), {
    timeout: 10_000,
  });
  const cleanupUserIds = new Set([
    ...(userId ? [userId] : []),
    ...database
      .prepare("SELECT id FROM users WHERE email LIKE 'nexora-live-ui-%'")
      .all()
      .map((user) => user.id),
  ]);
  database.transaction(() => {
    for (const id of cleanupUserIds) {
      database.prepare("DELETE FROM ai_usage WHERE user_id = ?").run(id);
      database.prepare("DELETE FROM knowledge_documents WHERE user_id = ?").run(id);
      database.prepare("DELETE FROM workspaces WHERE user_id = ?").run(id);
      database.prepare("DELETE FROM users WHERE id = ?").run(id);
    }
  })();
  database.close();
}
