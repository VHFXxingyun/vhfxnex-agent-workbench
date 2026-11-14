import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
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
if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(baseUrl.hostname)) {
  throw new Error("The live video smoke check only runs against a local NEXORA server.");
}
await assertSmokeTargetMatchesDatabaseOrExit(baseUrl);

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

const fixturePath = path.join(process.cwd(), "scripts/fixtures/blue-video-smoke.mp4");
const fixture = fs.readFileSync(fixturePath);
const resultPath =
  process.env.NEXORA_SMOKE_RESULT_FILE ||
  path.join(os.tmpdir(), `vhfxnex-video-smoke-${process.pid}-${Date.now()}.json`);
const clientAddress = `198.51.100.${crypto.randomInt(1, 255)}`;
const email = `nexora-video-${crypto.randomUUID()}@example.test`;
const password = crypto.randomBytes(24).toString("base64url");
let browser;
let page;
let userId;
let workspaceId;
let currentStage = "launch browser";
const result = {
  check: "video-vision-live-smoke",
  status: "running",
  startedAt: new Date().toISOString(),
  baseUrl: baseUrl.origin,
  cleanup: {},
};

function safeError(error) {
  const message = error instanceof Error ? error.message : "Unexpected smoke failure";
  return message
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, " ")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted]")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/\s+/g, " ")
    .slice(0, 400);
}

try {
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    reducedMotion: "reduce",
    extraHTTPHeaders: { "X-Forwarded-For": clientAddress },
  });
  page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto(baseUrl.href, { waitUntil: "domcontentloaded" });

  currentStage = "register isolated account";
  const registration = await page.evaluate(
    async ({ email, password }) => {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Video Smoke", email, password }),
      });
      return { status: response.status, payload: await response.json() };
    },
    { email, password },
  );
  assert.equal(registration.status, 200, registration.payload?.error || "registration failed");
  userId = registration.payload?.user?.id;
  assert.ok(userId, "registration must return an account ID");

  await page.reload({ waitUntil: "domcontentloaded" });
  const account = await page.evaluate(async () => {
    const response = await fetch("/api/auth/me");
    return response.json();
  });
  assert.equal(account.user?.id, userId);
  assert.equal(account.aiConfigured, true, "a server-configured DeepSeek key is required");
  await page.getByRole("button", { name: "开始探索" }).waitFor();
  if (await page.getByRole("button", { name: "演示模式已开启" }).isVisible()) {
    await page.getByRole("button", { name: "演示模式已开启" }).click();
  }

  currentStage = "extract local video frames";
  const imageChip = page.locator(".image-chip").filter({ hasText: "blue-video-smoke.mp4" });
  await page.locator(".plan-image-input").setInputFiles({
    name: "blue-video-smoke.mp4",
    mimeType: "video/mp4",
    buffer: fixture,
  });
  await imageChip.getByText(/关键帧/).waitFor({ timeout: 15_000 });

  let submittedImage;
  await page.route("**/api/plan", async (route) => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON();
      workspaceId = payload.workspaceId;
      submittedImage = payload.image;
    }
    await route.continue();
  });
  const prompt =
    "请只依据附加视频抽取的画面，识别画面中占满背景的颜色，并在计划摘要或任务里明确写出颜色。不要根据文件名推断。";
  await page.getByRole("textbox", { name: "描述你想完成的目标" }).fill(prompt);
  currentStage = "request live visual plan";
  const planningResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/plan" && response.request().method() === "POST",
    { timeout: 150_000 },
  );
  await page.getByRole("button", { name: "开始探索" }).click();
  const planningResponse = await planningResponsePromise;
  const planningPayload = await planningResponse.json().catch(() => null);
  result.planHttpStatus = planningResponse.status();
  result.liveMode = planningPayload?.mode === "live";
  result.persisted = planningPayload?.persisted === true;
  result.frameImageSubmitted = /^data:image\/jpeg;base64,/.test(submittedImage || "");
  if (planningPayload?.usage) {
    result.usage = {
      model: planningPayload.usage.model ?? null,
      inputTokens: planningPayload.usage.inputTokens ?? null,
      outputTokens: planningPayload.usage.outputTokens ?? null,
      totalTokens: planningPayload.usage.totalTokens ?? null,
      cache:
        planningPayload.usage.cacheMeasuredInputTokens === undefined
          ? { available: false }
          : {
              available: true,
              measuredInputTokens: planningPayload.usage.cacheMeasuredInputTokens,
              hitInputTokens: planningPayload.usage.cacheMeasuredHitTokens ?? 0,
            },
    };
  }
  assert.equal(
    planningResponse.status(),
    200,
    `Live video planning failed: ${planningPayload?.error || `HTTP ${planningResponse.status()}`}`,
  );
  assert.match(submittedImage || "", /^data:image\/jpeg;base64,/);
  assert.ok(Buffer.from(submittedImage.split(",")[1], "base64").byteLength > 500);
  assert.equal(planningPayload?.mode, "live");
  assert.equal(planningPayload?.persisted, true);
  const recognizedBlue = /蓝|blue/i.test(JSON.stringify(planningPayload?.plan));
  result.recognizedBlue = recognizedBlue;
  assert.ok(recognizedBlue, "the live plan must identify the blue frame extracted from the video");
  assert.ok(planningPayload?.usage?.totalTokens > 0);
  assert.equal(planningPayload?.usage?.model, "deepseek-flash");

  const cacheTelemetry = result.usage.cache;
  result.status = "passed";
  result.stage = "complete";
  console.log(
    `✓ Browser extracted a JPEG frame sheet from the blue MP4 and DeepSeek identified blue ` +
      `(${planningPayload.usage.totalTokens} tokens; ` +
      `${cacheTelemetry.available ? `${cacheTelemetry.hitInputTokens} cached input tokens` : "cache telemetry unavailable"}; ` +
      `one planning request).`,
  );
} catch (error) {
  result.status = "failed";
  result.stage = currentStage;
  result.error = {
    name: error instanceof Error ? error.name : "Error",
    message: safeError(error),
  };
  throw error;
} finally {
  if (page && workspaceId) {
    const deletion = await page
      .evaluate(async (id) => {
        const response = await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
        return response.status;
      }, workspaceId)
      .catch(() => null);
    result.cleanup.workspaceDeleteHttpStatus = deletion;
  }
  if (userId) {
    let database;
    try {
      database = new Database(resolveDatabasePath(), { timeout: 10_000 });
      database.transaction(() => {
        database.prepare("DELETE FROM ai_usage WHERE user_id = ?").run(userId);
        database.prepare("DELETE FROM knowledge_documents WHERE user_id = ?").run(userId);
        database.prepare("DELETE FROM workspaces WHERE user_id = ?").run(userId);
        database.prepare("DELETE FROM users WHERE id = ?").run(userId);
      })();
      result.cleanup.databaseRowsRemaining = database
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM users WHERE id = ?) +
             (SELECT COUNT(*) FROM workspaces WHERE user_id = ?) +
             (SELECT COUNT(*) FROM ai_usage WHERE user_id = ?) +
             (SELECT COUNT(*) FROM knowledge_documents WHERE user_id = ?) AS count`,
        )
        .get(userId, userId, userId, userId).count;
    } catch (error) {
      result.cleanup.error = safeError(error);
      result.status = "failed";
      process.exitCode = 1;
    } finally {
      database?.close();
    }
  }
  if (browser) {
    try {
      await browser.close();
    } catch (error) {
      result.cleanup.browserCloseError = safeError(error);
      result.status = "failed";
      process.exitCode = 1;
    }
  }
  result.finishedAt = new Date().toISOString();
  try {
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    console.log(`Smoke summary saved to ${resultPath}`);
  } catch (error) {
    process.exitCode = 1;
    console.error(`Could not save the video smoke summary: ${safeError(error)}`);
  }
}
