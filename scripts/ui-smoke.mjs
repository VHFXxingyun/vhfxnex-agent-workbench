import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import JSZip from "jszip";
import AxeBuilder from "@axe-core/playwright";
import { chromium, request } from "playwright-core";
import { readChatDocument } from "../src/lib/attachment-reader.mjs";
import { resolveDatabasePath } from "../src/lib/database-path.mjs";
import { loadSmokeEnvironment } from "./smoke-environment.mjs";

const { liveUiRequested } = loadSmokeEnvironment();
const baseUrl = new URL(process.env.NEXORA_BASE_URL || "http://localhost:3000");
const liveUiMode = liveUiRequested;
if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(baseUrl.hostname)) {
  throw new Error("The UI smoke check only runs against a local VHFXNEX server.");
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

const suffix = crypto.randomUUID();
const smokeClientAddress = `198.51.100.${crypto.randomInt(1, 255)}`;
const adminEmail = `nexora-ui-smoke-${suffix}@example.test`;
const memberEmail = `nexora-ui-member-${suffix}@example.test`;
const password = crypto.randomBytes(24).toString("base64url");
const adminName = "NEXORA UI Smoke";
const memberName = "NEXORA UI Member";
const redSwatchPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==",
  "base64",
);

function makePdfAttachmentFixture() {
  const stream = "BT /F1 16 Tf 72 720 Td (Browser PDF extraction verified) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "ascii");
}

const uiSmokeDownloadArtifacts = [
  {
    id: "ui-smoke-project-download",
    type: "code",
    title: "UI Smoke Starter Project",
    description: "用于检查代码项目 ZIP 下载。",
    content: "",
    files: [
      { path: "README.md", content: "# UI Smoke Starter\n\nRun with Node.js." },
      {
        path: "index.html",
        content:
          '<!doctype html><html><head><title>Local preview</title><link rel="stylesheet" href="./styles.css"><meta http-equiv="refresh" content="0;url=https://example.com"><script>document.body.dataset.scriptRan="yes";</script></head><body><main><h1>Local preview ready</h1><button id="inline-handler" onclick="document.body.dataset.inlineClick=\'ran\'">Local action</button><img id="external-probe" src="https://preview-probe.invalid/pixel.png" onerror="document.body.dataset.inlineError=\'ran\'"><a href="https://example.com">External link</a></main></body></html>',
      },
      {
        path: "styles.css",
        content:
          "h1 { color: rgb(89, 57, 135); } @media (max-width: 400px) { h1 { color: rgb(18, 52, 86); } }",
      },
      {
        path: "src/app.tsx",
        content: "export default function App() { return <main>Ready</main>; }",
      },
      { path: "docs/演示 说明.md", content: "打开 index.html 查看项目预览。" },
      { path: "docs/cafe\u0301.md", content: "Unicode normalization test." },
    ],
  },
  {
    id: "ui-smoke-spreadsheet-download",
    type: "spreadsheet",
    title: "UI Smoke Budget Workbook",
    description: "用于检查 Excel 工作簿下载。",
    content: JSON.stringify({
      sheets: [
        {
          name: "预算",
          columns: ["项目", "金额"],
          rows: [
            ["费用 & 物料", 1200],
            ["总计", 1200],
          ],
        },
      ],
    }),
  },
  {
    id: "ui-smoke-presentation-download",
    type: "presentation",
    title: "UI Smoke Presentation",
    description: "用于检查 PowerPoint 下载。",
    content: JSON.stringify({
      slides: [
        { title: "目标", bullets: ["明确需求", "形成交付"] },
        {
          title: "执行",
          bullets: ["拆分任务", "跟踪结果"],
          speakerNotes: "检查下载文件的备注。",
        },
      ],
    }),
  },
  {
    id: "ui-smoke-pdf-download",
    type: "pdf",
    title: "UI Smoke 中文 PDF",
    description: "检查中文字体嵌入与 PDF 下载。",
    content:
      "# PDF 活动方案\n\n**活动目标：** 检查生成文件中的中文文字与分页。\n\n1. 确认执行人员。\n2. 完成现场复盘。\n\n| 阶段 | 内容 |\n| --- | --- |\n| 筹备 | 确认场地 |",
  },
];
const screenshots = path.join(os.tmpdir(), `nexora-ui-smoke-${suffix}`);
fs.mkdirSync(screenshots, { recursive: true });

let browser;
let database;
let requestContext;
let mobileAuthContext;
let adminRecoveryCode;
const checkpoints = [];

function check(condition, label) {
  assert.ok(condition, label);
  checkpoints.push(label);
}

function contrastRatio(foreground, background) {
  const toLuminance = (color) => {
    const channels = color
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    assert.ok(channels?.length === 3, `Expected a computed RGB color, received ${color}`);
    const linear = channels.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const first = toLuminance(foreground);
  const second = toLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

async function closeConfirmation(page, label, confirmLabel, screenshotName) {
  const dialog = page.getByRole("alertdialog");
  try {
    await dialog.waitFor({ state: "visible" });
  } catch (error) {
    console.error(`Confirmation did not appear: ${label}`);
    console.error((await page.locator("body").innerText()).slice(0, 3000));
    await page.screenshot({ path: path.join(screenshots, "confirmation-missing.png") });
    throw error;
  }
  await assertVisible(dialog, label);
  if (screenshotName) {
    await page.screenshot({ path: path.join(screenshots, screenshotName) });
  }
  await dialog.getByRole("button", { name: confirmLabel, exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}

async function assertVisible(locator, message) {
  assert.equal(await locator.isVisible(), true, message);
}

async function settleViewport(page, viewport) {
  await page.waitForFunction(
    ({ width, height }) => window.innerWidth === width && window.innerHeight === height,
    viewport,
  );
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );
}

async function waitForRecoveryDialogAnimation(page) {
  await page.waitForFunction(() => {
    const backdrop = document.querySelector(".recovery-save-backdrop");
    const dialog = document.querySelector(".recovery-save-dialog");
    return Boolean(
      backdrop &&
      dialog &&
      Number.parseFloat(getComputedStyle(backdrop).opacity) >= 0.99 &&
      Number.parseFloat(getComputedStyle(dialog).opacity) >= 0.99,
    );
  });
}

async function assertNamedButtons(page, screenName) {
  const unnamed = await page
    .locator("button:visible")
    .evaluateAll((buttons) =>
      buttons
        .filter(
          (button) =>
            !button.getAttribute("aria-label") &&
            !button.getAttribute("aria-labelledby") &&
            !button.getAttribute("title") &&
            !button.innerText.trim(),
        )
        .map((button) => button.outerHTML.slice(0, 180)),
    );
  assert.deepEqual(unnamed, [], `${screenName} contains buttons without accessible names`);
  check(true, `All visible buttons have accessible names on ${screenName}`);
}

async function assertNamedFields(page, screenName) {
  const unnamed = await page
    .locator("input:visible, textarea:visible, select:visible")
    .evaluateAll((fields) =>
      fields
        .filter((field) => {
          const labels = field.labels;
          return (
            !field.getAttribute("aria-label") &&
            !field.getAttribute("aria-labelledby") &&
            !labels?.length &&
            !field.closest("label")
          );
        })
        .map((field) => field.outerHTML.slice(0, 180)),
    );
  assert.deepEqual(unnamed, [], `${screenName} contains fields without accessible names`);
  check(true, `All visible fields have accessible names on ${screenName}`);
}

async function assertAccessible(page, screenName) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const violations = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.map((node) => node.target),
  }));
  if (violations.length) {
    console.error(
      JSON.stringify(
        result.violations.flatMap((violation) =>
          violation.nodes.map((node) => ({
            target: node.target,
            html: node.html,
            contrast: node.any.map((check) => check.data),
          })),
        ),
        null,
        2,
      ),
    );
  }
  assert.deepEqual(violations, [], `${screenName} has WCAG accessibility violations`);
  check(true, `Pass axe-core WCAG 2.2 AA checks on ${screenName}`);
}

async function assertSmallPhoneAuth(page, screenName, screenshotName) {
  await page.setViewportSize({ width: 320, height: 720 });
  await settleViewport(page, { width: 320, height: 720 });
  const layout = await page.evaluate(() => {
    const card = document.querySelector(".auth-card");
    const heading = card?.querySelector("h2");
    const cardBounds = card?.getBoundingClientRect();
    const fieldsFit = [...document.querySelectorAll(".auth-card input")].every((field) => {
      const bounds = field.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= window.innerWidth;
    });
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      cardFits: Boolean(
        cardBounds && cardBounds.left >= 0 && cardBounds.right <= window.innerWidth,
      ),
      headingFits: Boolean(heading && heading.scrollWidth <= heading.clientWidth),
      fieldsFit,
    };
  });
  assert.equal(
    layout.documentWidth <= 320 && layout.cardFits && layout.headingFits && layout.fieldsFit,
    true,
    `${screenName} must fit a 320px viewport: ${JSON.stringify(layout)}`,
  );
  await assertAccessible(page, screenName.toLowerCase() + " at 320px");
  await page.screenshot({ path: path.join(screenshots, screenshotName), fullPage: true });
  check(true, `${screenName} fits and remains usable at a 320px viewport`);
}

try {
  const health = await fetch(baseUrl);
  assert.equal(health.status, 200, "VHFXNEX preview must be available");
  const serviceHealth = await fetch(new URL("/api/health", baseUrl));
  assert.equal(
    serviceHealth.status,
    200,
    "The application database and workbench worker must both report healthy",
  );
  check(true, "the application health endpoint verifies both SQLite and the background worker");

  browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    extraHTTPHeaders: { "X-Forwarded-For": smokeClientAddress },
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: baseUrl.origin,
  });
  await context.addInitScript(() => {
    const trackedWindow = window;
    trackedWindow.__goalflowUnhandledRejections = [];
    window.addEventListener(
      "unhandledrejection",
      (event) => {
        const reason = event.reason;
        trackedWindow.__goalflowUnhandledRejections.push({
          name: reason && typeof reason === "object" ? reason.name || "" : "",
          message:
            reason && typeof reason === "object" && "message" in reason
              ? String(reason.message)
              : String(reason),
        });
      },
      true,
    );
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  let resolvePlanUsage;
  let livePlanWorkspace;
  const planUsagePromise = new Promise((resolve) => {
    resolvePlanUsage = resolve;
  });
  page.on("response", async (response) => {
    if (!liveUiMode || !response.url().includes("/api/plan") || !response.ok()) return;
    try {
      const payload = await response.json();
      livePlanWorkspace = payload.workspace || null;
      resolvePlanUsage(payload.usage || livePlanWorkspace?.usage || null);
    } catch {
      resolvePlanUsage(null);
    }
  });
  page.setDefaultTimeout(8_000);
  page.setDefaultNavigationTimeout(30_000);
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "临时模拟服务不可用" }),
    }),
  );
  await page.goto(baseUrl.href, { waitUntil: "networkidle" });
  await page
    .getByRole("alert")
    .getByText(/暂时无法连接服务.*已有数据不会因此删除/)
    .waitFor();
  check(true, "Explain an initial session-check outage instead of silently treating it as logout");
  await page.unroute("**/api/auth/me");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByPlaceholder("例如：星云").waitFor();
  await assertNamedButtons(page, "registration");
  await assertNamedFields(page, "registration");
  await assertAccessible(page, "registration");

  await page.getByPlaceholder("例如：星云").fill(adminName);
  await page.getByPlaceholder("you@example.com").fill(adminEmail);
  await page.getByPlaceholder("至少 8 位字符").fill(password);
  await page.getByPlaceholder("再输入一次密码").fill(password);
  await page.getByRole("button", { name: "创建空间" }).click();
  try {
    const recoveryDialog = page.getByRole("dialog", { name: "先保存账户恢复码" });
    await recoveryDialog.waitFor();
    await waitForRecoveryDialogAnimation(page);
    await assertAccessible(page, "account recovery code dialog");
    adminRecoveryCode = await recoveryDialog.locator(".recovery-code-value").innerText();
    assert.match(adminRecoveryCode, /^[A-Za-z0-9_-]{40,}$/);
    const copyRecoveryButton = recoveryDialog.getByRole("button", { name: "复制恢复码" });
    const enterWorkspaceButton = recoveryDialog.getByRole("button", { name: "进入我的空间" });
    await copyRecoveryButton.waitFor();
    assert.equal(
      await copyRecoveryButton.evaluate((element) => element === document.activeElement),
      true,
      "the recovery dialog must move keyboard focus inside itself",
    );
    await page.keyboard.press("Shift+Tab");
    const savedRecoveryCheckbox = recoveryDialog.getByLabel("我已将恢复码保存在安全位置");
    assert.equal(
      await savedRecoveryCheckbox.evaluate((element) => element === document.activeElement),
      true,
      "the recovery dialog must wrap reverse keyboard focus",
    );
    await savedRecoveryCheckbox.check();
    await page.keyboard.press("Tab");
    assert.equal(
      await enterWorkspaceButton.evaluate((element) => element === document.activeElement),
      true,
      "the recovery dialog must include the enabled continuation action in its focus order",
    );
    await page.keyboard.press("Tab");
    assert.equal(
      await copyRecoveryButton.evaluate((element) => element === document.activeElement),
      true,
      "the recovery dialog must wrap forward keyboard focus",
    );
    await page.route("**/api/workspaces", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "临时模拟网络错误" }),
      }),
    );
    await enterWorkspaceButton.click();
    await page.getByRole("heading", { name: /接下来/ }).waitFor();
  } catch (error) {
    console.error("Registration screen after submit:", await page.locator("body").innerText());
    await page.screenshot({
      path: path.join(screenshots, "registration-error.png"),
      fullPage: true,
    });
    throw error;
  }
  check(true, "Register, save a recovery code, and enter the private workspace");

  await page.locator(".home-examples").waitFor();
  const homeFrame = await page.evaluate(() => {
    const examples = document.querySelector(".home-examples");
    const primary = document.querySelector(".home-primary");
    const topbar = document.querySelector(".topbar");
    return {
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      examplesInAside: examples?.parentElement?.classList.contains("home") ?? false,
      primaryAndExamplesAreSiblings: examples?.previousElementSibling === primary,
      topbarTop: topbar?.getBoundingClientRect().top ?? -1,
    };
  });
  assert.equal(homeFrame.examplesInAside, true);
  assert.equal(homeFrame.primaryAndExamplesAreSiblings, true);
  assert.ok(homeFrame.documentHeight <= homeFrame.viewportHeight, JSON.stringify(homeFrame));
  assert.equal(homeFrame.topbarTop, 0);
  check(
    true,
    "Keep home examples in a fixed side panel and fit the homepage in one desktop viewport",
  );
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await settleViewport(page, viewport);
    const compactHome = await page.evaluate(() => {
      const home = document.querySelector(".home");
      const examples = document.querySelector(".home-examples");
      const primary = document.querySelector(".home-primary");
      const topbar = document.querySelector(".topbar");
      const homeBounds = home?.getBoundingClientRect();
      const examplesBounds = examples?.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        documentHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        examplesAside: examples?.parentElement === home,
        fixedPrimaryAndExamples: examples?.previousElementSibling === primary,
        topbarTop: topbar?.getBoundingClientRect().top ?? -1,
        homeBottom: homeBounds?.bottom ?? Infinity,
        examplesBottom: examplesBounds?.bottom ?? Infinity,
        examplesOverflow: examples ? getComputedStyle(examples).overflowY : "missing",
      };
    });
    assert.ok(compactHome.documentWidth <= compactHome.viewportWidth, JSON.stringify(compactHome));
    assert.ok(
      compactHome.documentHeight <= compactHome.viewportHeight,
      JSON.stringify(compactHome),
    );
    assert.equal(compactHome.examplesAside, true);
    assert.equal(compactHome.fixedPrimaryAndExamples, true);
    assert.ok(Math.abs(compactHome.topbarTop) < 1);
    assert.ok(compactHome.homeBottom <= compactHome.viewportHeight, JSON.stringify(compactHome));
    assert.ok(
      compactHome.examplesBottom <= compactHome.viewportHeight,
      JSON.stringify(compactHome),
    );
    assert.equal(compactHome.examplesOverflow, "auto");
    check(true, "Keep the homepage fixed at " + viewport.width + "×" + viewport.height);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.getByRole("button", { name: /我的目标/ }).click();
  await page
    .getByRole("alert")
    .getByText(/列表读取失败，已有工作空间没有被删除/)
    .waitFor();
  await assertAccessible(page, "goal list load error");
  assert.equal(await page.getByRole("heading", { name: "还没有开始的目标" }).count(), 0);
  await page.unroute("**/api/workspaces");
  await page.getByRole("button", { name: "重试加载" }).click();
  await page.getByRole("heading", { name: "每个目标，都在向前。" }).waitFor();
  await assertAccessible(page, "empty goals list");
  await page.getByRole("button", { name: /探索入口/ }).click();
  await page.locator(".home-primary").waitFor({ state: "visible" });
  await page.getByRole("heading", { name: /接下来/ }).waitFor();
  assert.equal(await page.locator(".error-banner:visible").count(), 0);
  await assertAccessible(page, "signed-in home");
  await page.screenshot({ path: path.join(screenshots, "home-desktop.png"), fullPage: true });
  check(true, "Distinguish a failed history request from an empty account and allow retry");

  database = new Database(resolveDatabasePath(), {
    timeout: 10_000,
  });
  const promoteTestAdmin = database.prepare("UPDATE users SET role = 'admin' WHERE email = ?");
  assert.equal(promoteTestAdmin.run(adminEmail).changes, 1);
  const adminUsageUser = database.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail);
  const usageWorkspaceId = crypto.randomUUID();
  const usageWorkspaceTime = new Date().toISOString();
  database
    .prepare(
      "INSERT INTO workspaces (id, user_id, title, category, body, created_at, updated_at) VALUES (?, ?, ?, ?, '{}', ?, ?)",
    )
    .run(
      usageWorkspaceId,
      adminUsageUser.id,
      "用量拆分验证目标",
      "测试",
      usageWorkspaceTime,
      usageWorkspaceTime,
    );
  const insertAdminUsage = database.prepare(
    "INSERT INTO ai_usage (id, user_id, workspace_id, source, operation, model, input_tokens, cached_input_tokens, cache_measured_input_tokens, cache_measured_hit_tokens, output_tokens, total_tokens, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, 'smoke-model', ?, ?, ?, ?, ?, ?, 100, ?)",
  );
  insertAdminUsage.run(
    crypto.randomUUID(),
    adminUsageUser.id,
    usageWorkspaceId,
    "planner",
    "plan",
    1000,
    350,
    1000,
    350,
    100,
    1100,
    new Date().toISOString(),
  );
  insertAdminUsage.run(
    crypto.randomUUID(),
    adminUsageUser.id,
    usageWorkspaceId,
    "dialogue",
    "execute",
    500,
    0,
    0,
    0,
    100,
    600,
    new Date().toISOString(),
  );
  insertAdminUsage.run(
    crypto.randomUUID(),
    adminUsageUser.id,
    usageWorkspaceId,
    "workbench",
    "execute",
    700,
    0,
    0,
    0,
    100,
    800,
    new Date().toISOString(),
  );
  insertAdminUsage.run(
    crypto.randomUUID(),
    adminUsageUser.id,
    null,
    "healthcheck",
    "execute",
    20,
    0,
    0,
    0,
    2,
    22,
    new Date().toISOString(),
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "管理控制台" }).click();
  await page.getByRole("heading", { name: "管理控制台" }).waitFor();
  await page.getByText("累计 AI Token").waitFor();
  await page.getByRole("heading", { name: "AI 调用趋势" }).waitFor();
  const workspaceUsage = page.locator(".admin-workspace-usage").filter({ hasText: "2,500 tokens" });
  await workspaceUsage.waitFor({ state: "visible" });
  assert.match(
    await workspaceUsage.innerText(),
    /规划\s+1,100\s+·\s+对话\s+600\s+·\s+工作台\s+800/,
  );
  check(true, "Admin workspace view breaks down planner, dialogue, and workbench token usage");
  const usageBreakdown = page.locator(".usage-breakdown");
  await usageBreakdown.waitFor({ state: "visible" });
  assert.match(
    await usageBreakdown.innerText(),
    /输入缓存命中\s+[\d,]+\s+tokens/,
    "the seven-day usage panel should show its cached-input total",
  );
  assert.match(
    await usageBreakdown.innerText(),
    /输入缓存命中率\s+[\d.]+%/,
    "the seven-day usage panel should show the measured cache-hit rate",
  );
  assert.match(await usageBreakdown.innerText(), /1 次连接诊断/);
  check(true, "Include minimal provider connectivity probes in aggregate model usage");
  await page.locator(".usage-chart").waitFor();
  const tokenBreakdown = page.locator(".admin-usage-stat small").nth(1);
  await tokenBreakdown.waitFor();
  assert.match(await tokenBreakdown.innerText(), /输入.*缓存命中.*输出/);
  check(
    true,
    "Show aggregate AI usage, latency, and a seven-day activity chart in the admin console",
  );
  await assertNamedButtons(page, "admin console");
  await assertNamedFields(page, "admin console");
  await assertAccessible(page, "admin console");

  requestContext = await request.newContext({
    extraHTTPHeaders: { "X-Forwarded-For": smokeClientAddress },
  });
  const memberRegistration = await requestContext.post(
    new URL("/api/auth/register", baseUrl).href,
    {
      data: { name: memberName, email: memberEmail, password },
    },
  );
  assert.equal(memberRegistration.status(), 200, "a temporary member account must register");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "管理控制台" }).click();
  await page.getByRole("heading", { name: "管理控制台" }).waitFor();
  await page.locator(".ai-health").waitFor({ state: "visible" });
  const adminAiConfigured = await page.evaluate(async () => {
    const response = await fetch("/api/auth/me");
    const data = await response.json();
    return {
      configured: data.aiConfigured === true,
      cacheControl: response.headers.get("cache-control"),
    };
  });
  assert.match(adminAiConfigured.cacheControl || "", /private.*no-store|no-store.*private/i);
  const privateCollectionCacheControls = await page.evaluate(async () => {
    const responses = await Promise.all([
      fetch("/api/admin/overview"),
      fetch("/api/workspaces"),
      fetch("/api/knowledge"),
    ]);
    return responses.map((response) => response.headers.get("cache-control"));
  });
  for (const header of privateCollectionCacheControls) {
    assert.match(header || "", /private.*no-store|no-store.*private/i);
  }
  check(true, "Mark authenticated identity and administrator data as private and non-cacheable");
  const aiConnectionButton = page.getByRole("button", { name: "测试连接" });
  assert.equal(
    await aiConnectionButton.isDisabled(),
    !adminAiConfigured.configured,
    "AI connection testing must be available only when a server key is configured",
  );
  if (!adminAiConfigured.configured) {
    const unconfiguredProbe = await page.evaluate(async () => {
      const response = await fetch("/api/admin/ai-status", { method: "POST" });
      return { status: response.status, payload: await response.json() };
    });
    assert.equal(unconfiguredProbe.status, 503);
    assert.match(unconfiguredProbe.payload.error, /尚未配置 DeepSeek API Key/);
  }
  if (process.env.NEXORA_TEST_AI_STATUS === "1" && adminAiConfigured.configured) {
    await aiConnectionButton.click();
    await page.waitForFunction(() => {
      const card = document.querySelector(".ai-health");
      return (
        card?.classList.contains("ai-health-connected") ||
        card?.classList.contains("ai-health-error")
      );
    });
    const statusMessage = await page.locator(".ai-health-copy strong").innerText();
    await page.screenshot({ path: path.join(screenshots, "ai-connection-status.png") });
    check(true, `Admin AI connection check displayed a result: ${statusMessage}`);
  }
  check(true, "Admin console shows a safe, manual AI service connection check");

  await page.getByRole("button", { name: "账户设置" }).click();
  await page.getByRole("heading", { name: "你的空间，由你掌控。" }).waitFor();
  await assertNamedButtons(page, "account settings");
  await assertNamedFields(page, "account settings");
  await assertAccessible(page, "account settings");
  const updatedDisplayName = `${adminName} UI`;
  await page.getByLabel("显示名称").fill(updatedDisplayName);
  await page.getByRole("button", { name: "保存显示名称" }).click();
  await page.getByRole("status").filter({ hasText: "显示名称已更新" }).waitFor();
  await page.getByLabel("当前密码", { exact: true }).fill(password);
  const nextPassword = crypto.randomBytes(24).toString("base64url");
  await page.getByLabel("新密码", { exact: true }).fill(nextPassword);
  await page.getByLabel("确认新密码").fill(nextPassword);
  await page.getByRole("button", { name: "更新密码" }).click();
  await page.getByRole("status").filter({ hasText: "当前设备保持登录" }).waitFor();
  const accountIdentity = await page.evaluate(async () => {
    const response = await fetch("/api/auth/me");
    return response.json();
  });
  assert.equal(accountIdentity.user?.email, adminEmail);
  assert.equal(accountIdentity.user?.name, updatedDisplayName);
  await page.getByLabel("验证当前密码").fill(nextPassword);
  await page.getByRole("button", { name: "生成恢复码" }).click();
  const recoveryCodeResult = page.locator(".account-recovery-result");
  await recoveryCodeResult.waitFor({ state: "visible" });
  adminRecoveryCode = await recoveryCodeResult.locator("code").innerText();
  assert.match(adminRecoveryCode, /^[A-Za-z0-9_-]{40,}$/);
  const [recoveryDownload] = await Promise.all([
    page.waitForEvent("download"),
    recoveryCodeResult.getByRole("button", { name: "下载文件" }).click(),
  ]);
  assert.equal(recoveryDownload.suggestedFilename(), "vhfxnex-account-recovery.txt");
  check(
    true,
    "Change a password, rotate the one-time recovery code, and download it from account settings",
  );
  await page.getByRole("button", { name: "管理控制台" }).click();
  await page.getByRole("heading", { name: "管理控制台" }).waitFor();

  const memberRow = page.getByRole("row").filter({ hasText: memberEmail });
  await memberRow.getByRole("button", { name: "设为管理员" }).click();
  await closeConfirmation(
    page,
    "Changing a role uses the accessible in-app confirmation",
    "设为管理员",
    "access-confirmation.png",
  );
  await memberRow.getByText("管理员", { exact: true }).waitFor();
  check(true, "Promote a member through the admin screen");

  const memberRowAfterPromotion = page.getByRole("row").filter({ hasText: memberEmail });
  await memberRowAfterPromotion.getByRole("button", { name: `删除账户：${memberName}` }).click();
  await closeConfirmation(
    page,
    "Deleting an account explains the data that will be removed",
    "删除账户和资料",
    "delete-confirmation.png",
  );
  await memberRowAfterPromotion.waitFor({ state: "detached" });
  check(true, "Delete the temporary member and its private data from the admin screen");

  await page.getByRole("button", { name: "探索入口" }).click();
  const aiConfigured = await page.evaluate(async () => {
    const response = await fetch("/api/auth/me");
    const data = await response.json();
    return data.aiConfigured === true;
  });
  assert.equal(
    liveUiMode && !aiConfigured,
    false,
    "the live UI smoke check requires a server-configured DeepSeek key",
  );
  if (!aiConfigured) {
    assert.equal(
      await page.getByRole("button", { name: "演示模式已开启" }).isVisible(),
      true,
      "without an API key the workspace must default to visibly labeled demo mode",
    );
    assert.match(await page.locator(".mode-hint").innerText(), /未配置 DeepSeek Key/);
    assert.match(await page.locator(".model-label").innerText(), /DEMO AGENT/);
    const liveResponse = await page.evaluate(async () => {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "请规划一个目标执行流程并生成关键任务",
          demo: false,
        }),
      });
      return { status: response.status, payload: await response.json() };
    });
    assert.equal(liveResponse.status, 503);
    assert.match(liveResponse.payload.error, /尚未配置 DeepSeek API Key/);
    check(true, "Missing API credentials are clearly labeled and live planning fails explicitly");
  }
  if (aiConfigured) {
    if (await page.getByRole("button", { name: "演示模式已开启" }).isVisible()) {
      await page.getByRole("button", { name: "演示模式已开启" }).click();
    }
    await page.locator(".plan-image-input").setInputFiles({
      name: "spoofed.png",
      mimeType: "image/png",
      buffer: Buffer.from("not a PNG image"),
    });
    await page
      .locator(".error-banner")
      .getByText(/文件内容与图片类型不一致/)
      .waitFor();
    assert.equal(await page.locator(".image-chip").count(), 0);
    check(true, "Reject a mislabeled image in the upload control before it enters the request");
    for (const video of [
      { extension: "webm", mimeType: "video/webm" },
      { extension: "mp4", mimeType: "video/mp4" },
      { extension: "mov", mimeType: "video/quicktime" },
    ]) {
      const name = `local-video-smoke.${video.extension}`;
      const fixture = fs.readFileSync(path.join(process.cwd(), "scripts/fixtures", name));
      const videoChip = page.locator(".image-chip").filter({ hasText: name });
      await page.locator(".plan-image-input").setInputFiles({
        name,
        mimeType: video.mimeType,
        buffer: fixture,
      });
      try {
        await videoChip.getByText(/关键帧/).waitFor({ timeout: 15_000 });
      } catch (error) {
        console.error(
          "Local video extraction diagnostics:",
          JSON.stringify({
            name,
            fixtureBytes: fixture.byteLength,
            chips: await page.locator(".image-chip").allTextContents(),
            alert: await page
              .locator(".error-banner:visible")
              .innerText()
              .catch(() => ""),
          }),
        );
        throw error;
      }
      await videoChip.getByRole("button", { name: "移除图片" }).click();
    }
    check(
      true,
      "Extract WebM, MP4, and MOV contact sheets locally before the Agent receives any image frames",
    );
    if (liveUiMode) {
      await page.locator(".plan-image-input").setInputFiles({
        name: "red-swatch.png",
        mimeType: "image/png",
        buffer: redSwatchPng,
      });
      await page.locator(".image-chip").getByText("red-swatch.png").waitFor();
      check(true, "Preview a valid reference image before sending it to live planning");
      await page.locator(".plan-document-input").setInputFiles({
        name: "活动要求.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("面向在校学生；必须使用室内场地；预算上限 3000 元。", "utf8"),
      });
      await page.locator(".plan-attachment-chip").getByText("活动要求.md").waitFor();
      check(true, "Attach a planning document before generating the initial route");
    }
    if (!liveUiMode) await page.getByRole("button", { name: "切换演示模式" }).click();
  } else if (await page.getByRole("button", { name: "切换演示模式" }).isVisible()) {
    await page.getByRole("button", { name: "切换演示模式" }).click();
  }
  if (liveUiMode) {
    await page.getByRole("button", { name: "切换演示模式" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "添加截图或参考图" }).isDisabled(), false);
    assert.equal(await page.getByRole("button", { name: "添加资料" }).isDisabled(), false);
    check(true, "Keep the browser workflow on the live DeepSeek path");
  } else {
    await page.getByRole("button", { name: "演示模式已开启" }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "添加截图" }).isDisabled(),
      true,
      "image upload must be disabled in demo mode",
    );
    assert.equal(
      await page.getByRole("button", { name: "添加资料" }).isDisabled(),
      true,
      "document upload must be disabled in demo mode",
    );
    assert.match(
      await page.locator(".mode-hint").innerText(),
      aiConfigured ? /演示模式不处理图片/ : /未配置 DeepSeek Key/,
    );
  }
  const planningPrompt = liveUiMode
    ? "先识别参考图中占比最大的颜色（如果是纯色块，请直接给出颜色名称），再围绕该颜色规划一场校园 AI 社团招新海报评审活动，预算 3000 元，包含筹备、宣传、执行和复盘，并安排 3 小时现场议程；只将确实无法辨认的内容列为待确认。"
    : "规划一场校园 AI 社团招新活动，预算 3000 元，包含筹备、宣传、现场执行和复盘，并安排 3 小时现场议程。";
  const planningInput = page.getByRole("textbox", { name: "描述你想完成的目标" });
  await planningInput.fill(planningPrompt);
  const pageErrorCountBeforeCancellation = pageErrors.length;
  const rejectionCountBeforeCancellation = await page.evaluate(
    () => window.__goalflowUnhandledRejections?.length || 0,
  );
  let releaseHeldPlan;
  let markHeldPlanSeen;
  let finishHeldPlan;
  const heldPlanSeen = new Promise((resolve) => {
    markHeldPlanSeen = resolve;
  });
  const heldPlanFinished = new Promise((resolve) => {
    finishHeldPlan = resolve;
  });
  await page.route("**/api/plan", async (route) => {
    markHeldPlanSeen();
    await new Promise((resolve) => {
      releaseHeldPlan = resolve;
    });
    try {
      await route.abort();
    } catch {}
    finishHeldPlan();
  });
  await page.getByRole("button", { name: "开始探索" }).click();
  await heldPlanSeen;
  await page.getByRole("button", { name: "停止目标分析" }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "停止目标分析" }).click();
  await page.getByRole("alert").getByText("已停止本次分析").waitFor();
  assert.equal(
    await planningInput.inputValue(),
    planningPrompt,
    "stopping analysis must preserve the submitted goal",
  );
  releaseHeldPlan?.();
  await heldPlanFinished;
  await page.unroute("**/api/plan");
  await page.waitForTimeout(100);
  const cancellationRejections = await page.evaluate(
    (startIndex) => (window.__goalflowUnhandledRejections || []).slice(startIndex),
    rejectionCountBeforeCancellation,
  );
  assert.deepEqual(
    cancellationRejections.filter((rejection) => rejection.name === "AbortError"),
    [],
    "stopping an in-flight request must not leak an unhandled AbortError",
  );
  assert.deepEqual(
    pageErrors
      .slice(pageErrorCountBeforeCancellation)
      .filter((error) => error.name === "AbortError"),
    [],
    "stopping an in-flight request must not open a browser runtime error overlay",
  );
  const nextOverlayText = (await page.locator("nextjs-portal").allTextContents()).join(" ");
  assert.doesNotMatch(
    nextOverlayText,
    /Runtime AbortError|Unhandled Runtime Error|signal is aborted without reason/i,
    "the Next development overlay must not report an aborted request as an uncaught runtime error",
  );
  check(
    true,
    "Handle request cancellation without an unhandled AbortError or Next runtime overlay",
  );
  check(true, "Stop a pending planning request while keeping the submitted goal available");

  let liveImagePayloadMatches = false;
  let livePlanningAttachmentMatches = false;
  let planningThinkingMode;
  let planningRequestCount = 0;
  let plannedWorkspaceId;
  await page.route("**/api/plan", async (route) => {
    planningRequestCount += 1;
    const payload = route.request().postDataJSON();
    plannedWorkspaceId = payload.workspaceId;
    planningThinkingMode = payload.thinkingMode;
    if (liveUiMode) {
      liveImagePayloadMatches =
        payload.image === `data:image/png;base64,${redSwatchPng.toString("base64")}`;
      livePlanningAttachmentMatches = payload.attachments?.some(
        (attachment) =>
          attachment.name === "活动要求.md" && attachment.content.includes("必须使用室内场地"),
      );
    }
    await route.continue();
  });
  let failedWorkspaceWrite = false;
  if (!liveUiMode) {
    await page.route("**/api/workspaces", async (route) => {
      if (route.request().method() === "POST" && !failedWorkspaceWrite) {
        failedWorkspaceWrite = true;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "临时模拟写入错误" }),
        });
        return;
      }
      await route.continue();
    });
  }
  await page.getByRole("button", { name: "开始探索" }).click();
  await page.locator(".workspace-chat").waitFor({ timeout: liveUiMode ? 210_000 : 8_000 });
  await page.locator(".workspace-chat .chat-route-picker").waitFor({ state: "visible" });
  assert.equal(
    planningThinkingMode,
    "deep",
    "new goals must preserve the default deep thinking mode",
  );
  check(true, "Send the default deep thinking mode with the initial planning request");
  if (liveUiMode) {
    assert.match(plannedWorkspaceId || "", /^[0-9a-f-]{36}$/i);
    const persistedLivePlan = await page.evaluate(async (id) => {
      const response = await fetch(`/api/workspaces/${id}`);
      return { status: response.status, ...(await response.json()) };
    }, plannedWorkspaceId);
    assert.equal(persistedLivePlan.status, 200);
    assert.equal(persistedLivePlan.workspace?.prompt, planningPrompt);
    check(true, "Recover the live plan from its server-persisted workspace ID");
  } else {
    await page.locator(".error-banner").getByText("临时模拟写入错误").waitFor();
    await page.setViewportSize({ width: 320, height: 720 });
    const retryBannerBounds = await page.locator(".error-banner").evaluate((banner) => {
      const bounds = banner.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, viewport: window.innerWidth };
    });
    assert.ok(
      retryBannerBounds.left >= 0 && retryBannerBounds.right <= retryBannerBounds.viewport,
      `the save retry banner must fit on a 320 px phone: ${JSON.stringify(retryBannerBounds)}`,
    );
    assert.equal(await page.getByRole("button", { name: "重试保存工作空间" }).isVisible(), true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "重试保存工作空间" }).click();
    await page.getByRole("button", { name: "重试保存工作空间" }).waitFor({ state: "detached" });
  }
  assert.equal(
    planningRequestCount,
    1,
    "persisting or retrying a plan must not call the AI planner again",
  );
  const persistedAfterRetry = await page.evaluate(async () => {
    const response = await fetch("/api/workspaces");
    return { ...(await response.json()), cacheControl: response.headers.get("cache-control") };
  });
  assert.equal(persistedAfterRetry.workspaces.length, 1);
  assert.match(persistedAfterRetry.cacheControl || "", /private.*no-store|no-store.*private/i);
  if (!liveUiMode) {
    check(
      true,
      "Keep a generated plan visible after a write failure and retry persistence without rerunning AI",
    );
    check(true, "Keep the save recovery controls inside a 320 px phone viewport");
  }
  const livePlanUsage = liveUiMode ? await planUsagePromise : null;
  if (liveUiMode) {
    assert.equal(livePlanUsage?.model, "deepseek-flash");
    assert.ok(livePlanUsage?.totalTokens > 0);
    const planningUsageCard = page.locator(".plan-usage-brief");
    await planningUsageCard.waitFor({ state: "visible" });
    const planningUsageText = await planningUsageCard.innerText();
    assert.match(planningUsageText, /deepseek-flash/);
    assert.match(planningUsageText, /规划阶段/);
    assert.equal(
      Number(planningUsageText.match(/[\d,]+(?= tokens)/)?.[0]?.replaceAll(",", "")),
      livePlanUsage.totalTokens,
    );
    check(true, "Show actual planning usage before the user confirms execution");
    assert.equal(
      liveImagePayloadMatches,
      true,
      "the browser must send the exact selected PNG bytes to the planning API",
    );
    assert.equal(
      livePlanningAttachmentMatches,
      true,
      "the browser must send the extracted document text to the planning API",
    );
    check(true, "Use an attached planning document as input to the initial route");
    const livePlanningConversation = await page.locator(".workspace-chat").innerText();
    assert.match(
      livePlanningConversation,
      /红|橙|red|orange/i,
      "the live browser plan must identify the dominant hue in the uploaded pure-color swatch",
    );
    assert.match(
      livePlanningConversation,
      /室内/,
      "the live browser plan must apply the attached document's venue constraint",
    );
    check(true, "Use the uploaded color swatch and attached venue constraint in the live plan");
  } else {
    assert.equal(
      await page.locator(".plan-usage-brief").count(),
      0,
      "demo planning must not display fabricated model usage",
    );
    check(true, "Keep planning usage hidden for demo data");
  }
  if (!liveUiMode) {
    assert.doesNotMatch(
      await page.locator(".workspace-head h1").innerText(),
      /^[\s，,、；;：:。！？!?]/,
      "a generated workspace title must not begin with punctuation",
    );
  }
  assert.equal(
    await page
      .locator(".workspace-head h1")
      .evaluate((heading) => getComputedStyle(heading).textWrap),
    "balance",
    "workspace titles should balance their lines instead of leaving a short orphan line",
  );
  check(true, "Balance long workspace-title line breaks beside header actions");
  await assertNamedButtons(page, "route selection");
  await assertAccessible(page, "route selection");
  const routeCards = page.locator(".workspace-chat .chat-route-option");
  assert.equal(await routeCards.count(), 3);
  assert.equal(await routeCards.nth(0).getAttribute("aria-pressed"), "true");
  assert.equal(await routeCards.nth(1).getAttribute("aria-pressed"), "false");
  assert.equal(await routeCards.nth(0).getAttribute("data-recommended"), "true");
  assert.equal(await page.locator(".workspace-side-panel .chat-route-option").count(), 0);
  const routeVisibility = await page.locator(".chat-route-picker").evaluate((picker) => {
    const thread = picker.closest(".workspace-chat-thread");
    const bounds = picker.getBoundingClientRect();
    const threadBounds = thread.getBoundingClientRect();
    return {
      intersectsThread: bounds.top < threadBounds.bottom && bounds.bottom > threadBounds.top,
      followsLatest: thread.scrollHeight - thread.scrollTop - thread.clientHeight < 8,
    };
  });
  assert.equal(
    routeVisibility.intersectsThread && routeVisibility.followsLatest,
    true,
    `the route chooser should appear in the chat immediately after planning: ${JSON.stringify(routeVisibility)}`,
  );
  const routePositions = await routeCards.evaluateAll((cards) =>
    cards.map((card) => {
      const bounds = card.getBoundingClientRect();
      return { top: bounds.top, left: bounds.left };
    }),
  );
  assert.ok(
    routePositions[0].top <= routePositions[1].top &&
      routePositions[1].top <= routePositions[2].top &&
      (routePositions[0].top !== routePositions[1].top ||
        routePositions[0].left < routePositions[1].left),
    "the AI-recommended route must lead the alternatives in the chat decision bubble",
  );
  assert.equal(await page.locator(".chat-user .chat-message-author").count(), 0);
  assert.equal(await page.locator(".chat-user .chat-message-mark").count(), 0);
  assert.equal(
    (await page.locator(".workspace-side-panel .planned-task-list article").count()) > 0,
    true,
  );
  check(
    true,
    "Keep route choice in the conversation and reserve the side panel for the action plan",
  );
  const thinkingControl = page.getByRole("combobox", { name: "Agent 思考强度" });
  await thinkingControl.selectOption("deep");
  assert.equal(await thinkingControl.inputValue(), "deep");
  await thinkingControl.selectOption("fast");
  check(true, "Expose fast and deep thinking modes in the main conversation composer");

  const attachmentDocx = new JSZip();
  attachmentDocx.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  attachmentDocx.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  attachmentDocx.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Browser DOCX extraction verified</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
  );
  const attachmentDocxBuffer = await attachmentDocx.generateAsync({ type: "nodebuffer" });
  const attachmentXlsx = new JSZip();
  attachmentXlsx.file(
    "xl/sharedStrings.xml",
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Browser spreadsheet context</t></si></sst>',
  );
  attachmentXlsx.file(
    "xl/worksheets/sheet1.xml",
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>',
  );
  const attachmentXlsxBuffer = await attachmentXlsx.generateAsync({ type: "nodebuffer" });
  const attachmentPptx = new JSZip();
  attachmentPptx.file(
    "ppt/slides/slide1.xml",
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>Browser presentation context</a:t></p:sld>',
  );
  const attachmentPptxBuffer = await attachmentPptx.generateAsync({ type: "nodebuffer" });
  await page.locator('.workspace-chat-composer input[type="file"]').setInputFiles([
    {
      name: "活动参考.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# 活动约束\n预算与时间待确认。", "utf8"),
    },
    {
      name: "方案说明.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: attachmentDocxBuffer,
    },
    {
      name: "预算参考.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: attachmentXlsxBuffer,
    },
    {
      name: "汇报参考.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: attachmentPptxBuffer,
    },
    {
      name: ".env.example",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("API_KEY=example\n", "utf8"),
    },
    { name: "配色参考.png", mimeType: "image/png", buffer: redSwatchPng },
  ]);
  await page.locator(".chat-attachment-chip").first().waitFor();
  assert.equal(await page.locator(".chat-attachment-chip").count(), 6);
  assert.match(await page.locator(".chat-attachment-list").innerText(), /活动参考\.md/);
  assert.match(await page.locator(".chat-attachment-list").innerText(), /方案说明\.docx/);
  assert.match(await page.locator(".chat-attachment-list").innerText(), /预算参考\.xlsx/);
  assert.match(await page.locator(".chat-attachment-list").innerText(), /汇报参考\.pptx/);
  assert.match(await page.locator(".chat-attachment-list").innerText(), /\.env\.example/);
  assert.match(await page.locator(".chat-attachment-list").innerText(), /配色参考\.png/);
  check(
    true,
    "Extract browser DOCX/XLSX/PPTX, Markdown, and .env.example attachments with an image",
  );
  for (let index = 0; index < 6; index += 1) {
    await page
      .locator(".chat-attachment-chip")
      .getByRole("button", { name: /移除附件/ })
      .first()
      .click();
  }
  assert.equal(await page.locator(".chat-attachment-chip").count(), 0);
  check(true, "Remove attachments before sending them to the Agent");
  await page.screenshot({
    path: path.join(screenshots, "route-recommended.png"),
    fullPage: true,
  });
  check(true, "Show the AI recommendation first in the in-chat route selector");
  await routeCards.nth(1).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.workspace-chat .chat-route-option[aria-pressed="true"]')
        .length === 1 &&
      document.querySelector(
        '.workspace-chat .chat-route-option:nth-of-type(2)[aria-pressed="true"]',
      ),
  );
  check(true, "Expose and persist the selected route through an accessible pressed state");
  await page.screenshot({ path: path.join(screenshots, "route-selection.png"), fullPage: true });
  check(true, "Let the user replace the recommended route with an alternative");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => window.matchMedia("(max-width: 700px)").matches);
  await page.waitForFunction(() => {
    const recommended = document.querySelector(
      '.workspace-chat .chat-route-option[data-recommended="true"]',
    );
    const firstAlternative = document.querySelector(
      ".workspace-chat .chat-route-option:nth-of-type(2)",
    );
    return (
      recommended &&
      firstAlternative &&
      getComputedStyle(recommended).order === "-1" &&
      getComputedStyle(firstAlternative).order === "0"
    );
  });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    "mobile route selection must not overflow horizontally",
  );
  const titleCharsPerLine = await page.locator(".workspace-head h1").evaluate((heading) => {
    const node = heading.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return [];
    const range = document.createRange();
    const lines = new Map();
    for (let index = 0; index < node.textContent.length; index += 1) {
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const rect = range.getBoundingClientRect();
      const top = Math.round(rect.top);
      lines.set(top, (lines.get(top) || 0) + 1);
    }
    return [...lines.values()];
  });
  assert.ok(
    titleCharsPerLine.every((count) => count >= 2),
    `mobile workspace headings must not strand a single character on a line: ${JSON.stringify(titleCharsPerLine)}`,
  );
  const mobileRouteTops = await routeCards.evaluateAll((cards) =>
    cards.map((card) => ({
      top: card.getBoundingClientRect().top,
      order: getComputedStyle(card).order,
      className: card.className,
      viewport: window.innerWidth,
      mobileMedia: window.matchMedia("(max-width: 700px)").matches,
    })),
  );
  assert.ok(
    mobileRouteTops[0].top < mobileRouteTops[1].top &&
      mobileRouteTops[1].top < mobileRouteTops[2].top,
    `the AI recommendation must lead the route list on mobile: ${JSON.stringify(mobileRouteTops)}`,
  );
  assert.equal(await routeCards.nth(1).getAttribute("aria-pressed"), "true");
  await page.screenshot({
    path: path.join(screenshots, "mobile-route-options.png"),
    fullPage: true,
  });
  check(true, "Keep route options in recommendation-first order on narrow screens");
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForFunction(() => window.innerWidth === 768);
  const tabletRouteLayout = await page.evaluate(() => {
    const routeField = document.querySelector(".chat-route-options");
    const menu = document.querySelector(".mobile-menu");
    const cards = [...document.querySelectorAll(".workspace-chat .chat-route-option")];
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      routeFieldWidth: routeField?.clientWidth ?? 0,
      routeFieldScrollWidth: routeField?.scrollWidth ?? 0,
      menuVisible: menu && getComputedStyle(menu).display !== "none",
      cardBounds: cards.map((card) => {
        const bounds = card.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, width: bounds.width };
      }),
    };
  });
  assert.equal(
    tabletRouteLayout.documentWidth <= tabletRouteLayout.viewportWidth,
    true,
    `tablet route selection must not overflow the page: ${JSON.stringify(tabletRouteLayout)}`,
  );
  assert.equal(tabletRouteLayout.menuVisible, true, "tablet navigation must use the menu control");
  assert.equal(
    tabletRouteLayout.cardBounds.length,
    3,
    "all three route choices must remain visible on tablet widths",
  );
  assert.ok(
    tabletRouteLayout.cardBounds.every(
      (card) =>
        card.width >= 150 && card.left >= 0 && card.right <= tabletRouteLayout.viewportWidth,
    ),
    `tablet route cards must remain readable and in bounds: ${JSON.stringify(tabletRouteLayout)}`,
  );
  await page.screenshot({
    path: path.join(screenshots, "tablet-route-options.png"),
    fullPage: true,
  });
  check(true, "Keep all route choices readable with compact navigation at tablet widths");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(() => !window.matchMedia("(max-width: 700px)").matches);
  check(
    true,
    liveUiMode
      ? "Generate route options with the live DeepSeek planner in the browser"
      : "Switch to demo mode and generate route options in the browser",
  );

  let simulatedExecutionStreamDrop = false;
  const simulateExecutionStreamDrop = async (route) => {
    const requestBody = route.request().postDataJSON();
    assert.equal(requestBody.workspaceId, plannedWorkspaceId);
    const row = database
      .prepare("SELECT body, user_id FROM workspaces WHERE id = ?")
      .get(requestBody.workspaceId);
    assert.ok(row?.body, "the live plan must be persisted before execution begins");
    const savedWorkspace = JSON.parse(row.body);
    const selectedRouteId = requestBody.route?.id;
    assert.ok(savedWorkspace.plan.routes.some((item) => item.id === selectedRouteId));
    const usage = {
      model: "deepseek-flash",
      inputTokens: 100,
      outputTokens: 60,
      totalTokens: 160,
      latencyMs: 80,
      requests: 1,
    };
    const result = {
      summary: "浏览器断流恢复检查已完成；结果来自服务器已保存的工作区。",
      tasks: savedWorkspace.plan.tasks.length
        ? savedWorkspace.plan.tasks.map((task) => ({
            ...task,
            status: "pending",
          }))
        : [
            {
              id: "ui-smoke-recovered-task",
              title: "确认活动场地与时间",
              detail: "检查场地档期并确认执行时段。",
              phase: "准备",
              status: "pending",
            },
          ],
      milestones: [
        {
          label: "准备与分工",
          date: "第 1 天 · 10:00–10:15",
          note: "确认目标、负责人和交付内容。",
        },
        {
          label: "现场执行",
          date: "第 1 天 · 10:30–11:00",
          note: "按执行清单完成核心环节。",
        },
      ],
      artifacts: [
        {
          id: "ui-smoke-recovered-plan",
          type: "document",
          title: "初版方案与恢复检查",
          description: "用于检查 SSE 断流后的工作区恢复。",
          content:
            "## 执行方案\n\n**核心目标：** _按任务清单_ 完成准备、~~临时项~~、现场执行和 `recap`。参见[执行规范](https://example.com/guide)。\n\n1. 确认负责人与时段\n2. 完成执行与复盘\n\n- 发送确认信息\n\n| 阶段 | 交付物 |\n| --- | --- |\n| 准备 | 清单 |\n| 复盘 | 记录 |\n\n> 保持确认信息清楚。\n\n```ts\nconst ready = true;\n```",
        },
        {
          id: "ui-smoke-recovered-timeline",
          type: "timeline",
          title: "执行时间线",
          description: "按时间推进的关键节点。",
          content: "10:00 准备与分工\n10:30 现场执行",
        },
        {
          id: "ui-smoke-recovered-budget",
          type: "budget",
          title: "预算明细",
          description: "断流恢复检查使用的示例预算。",
          content: "物料：¥1200\n机动：¥300\n合计：¥1500",
        },
        ...uiSmokeDownloadArtifacts,
      ],
      events: [
        {
          id: "ui-smoke-recovered-task-event",
          name: "create_tasks",
          title: "任务清单已保存",
          detail: "已恢复执行任务与它们的待办状态。",
          status: "done",
        },
        {
          id: "ui-smoke-recovered-schedule-event",
          name: "build_schedule",
          title: "执行时间线已生成",
          detail: "已保存两个具体时间段。",
          status: "done",
        },
        {
          id: "ui-smoke-recovered-search-event",
          name: "search_web",
          title: "联网搜索完成",
          detail: "搜索活动执行规范，找到 1 条网页结果。",
          status: "done",
          sources: [
            {
              title: "活动安全指南",
              url: "https://example.com/activity-guide",
              snippet: "活动前应明确参与者安全与现场责任。",
            },
          ],
        },
      ],
      usage,
      budget: { limit: 3000, total: 1500, remaining: 1500, status: "within" },
    };
    const previousUsage = savedWorkspace.usage || {
      model: usage.model,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      latencyMs: 0,
      requests: 0,
    };
    const nextWorkspace = {
      ...savedWorkspace,
      selectedRouteId,
      result,
      usage: {
        model: usage.model,
        inputTokens: previousUsage.inputTokens + usage.inputTokens,
        outputTokens: previousUsage.outputTokens + usage.outputTokens,
        totalTokens: previousUsage.totalTokens + usage.totalTokens,
        latencyMs: previousUsage.latencyMs + usage.latencyMs,
        requests: previousUsage.requests + usage.requests,
      },
      mode: "live",
    };
    database
      .prepare(
        "UPDATE workspaces SET title = ?, category = ?, body = ?, updated_at = ? WHERE id = ? AND user_id = ?",
      )
      .run(
        nextWorkspace.plan.title,
        nextWorkspace.plan.category,
        JSON.stringify(nextWorkspace),
        new Date().toISOString(),
        nextWorkspace.id,
        row.user_id,
      );
    simulatedExecutionStreamDrop = true;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      headers: { "cache-control": "no-cache, no-transform" },
      body: [
        JSON.stringify({ type: "status", message: "Agent 正在整理执行成果…" }),
        JSON.stringify({
          type: "tool",
          title: "任务清单已写入",
          detail: "任务结果已经安全保存到工作区。",
        }),
      ]
        .map((event) => `data: ${event}\n\n`)
        .join(""),
    });
  };
  let injectedDemoArtifacts = false;
  if (liveUiMode) {
    await page.route("**/api/execute", simulateExecutionStreamDrop);
  } else {
    await page.route("**/api/execute", async (route) => {
      const requestBody = route.request().postDataJSON();
      if (
        route.request().method() !== "POST" ||
        requestBody?.demo !== true ||
        requestBody?.continuation
      ) {
        return route.continue();
      }
      const response = await route.fetch();
      const payload = await response.json();
      assert.ok(payload?.result && Array.isArray(payload.result.artifacts));
      payload.result.artifacts = [
        ...payload.result.artifacts.filter((artifact) => artifact.type !== "code"),
        ...uiSmokeDownloadArtifacts.map((artifact) => structuredClone(artifact)),
      ];
      injectedDemoArtifacts = true;
      await route.fulfill({ response, body: JSON.stringify(payload) });
    });
  }
  await page.getByRole("button", { name: "开始全程执行" }).click();
  await page
    .locator(".workspace-side-panel .execution .task-list")
    .waitFor({ timeout: liveUiMode ? 210_000 : 8_000 });
  if (liveUiMode) {
    assert.equal(simulatedExecutionStreamDrop, true);
    assert.ok((await page.locator(".task-list").innerText()).length > 0);
    await page.waitForFunction(async (id) => {
      const response = await fetch(`/api/workspaces/${id}`);
      const payload = await response.json();
      return (payload.workspace?.conversation || []).some(
        (message) =>
          message.role === "assistant" && message.progress?.includes("Agent 正在整理执行成果…"),
      );
    }, plannedWorkspaceId);
    const restoredWorkspace = await page.evaluate(async (id) => {
      const response = await fetch(`/api/workspaces/${id}`);
      return { status: response.status, ...(await response.json()) };
    }, plannedWorkspaceId);
    assert.equal(restoredWorkspace.status, 200);
    assert.equal(restoredWorkspace.workspace?.result?.events.length, 3);
    assert.ok(restoredWorkspace.workspace?.usage?.totalTokens > livePlanUsage.totalTokens);
    assert.ok(
      restoredWorkspace.workspace?.conversation?.some(
        (message) =>
          message.role === "assistant" && message.progress?.includes("Agent 正在整理执行成果…"),
      ),
    );
    check(
      true,
      "Restore the server-saved Agent result and progress after the final SSE event is lost",
    );
    await page.unroute("**/api/execute", simulateExecutionStreamDrop);

    const savedBeforeStopTitle = "停止前已提交的执行结果";
    let releaseStoppedExecution;
    let markStoppedExecutionSeen;
    const stoppedExecutionSeen = new Promise((resolve) => {
      markStoppedExecutionSeen = resolve;
    });
    const simulateStopAfterCommit = async (route) => {
      const requestBody = route.request().postDataJSON();
      const row = database
        .prepare("SELECT body, user_id FROM workspaces WHERE id = ?")
        .get(requestBody.workspaceId);
      assert.ok(row?.body, "the active workspace must still exist before the stopped turn");
      const savedWorkspace = JSON.parse(row.body);
      const committedEvent = {
        id: "ui-smoke-stop-after-commit",
        name: "create_tasks",
        title: savedBeforeStopTitle,
        detail: "服务器已经保存结果，但浏览器尚未收到最终事件。",
        status: "done",
      };
      savedWorkspace.result.events = [...savedWorkspace.result.events, committedEvent];
      savedWorkspace.usage = {
        ...savedWorkspace.usage,
        inputTokens: savedWorkspace.usage.inputTokens + 3,
        outputTokens: savedWorkspace.usage.outputTokens + 2,
        totalTokens: savedWorkspace.usage.totalTokens + 5,
        latencyMs: savedWorkspace.usage.latencyMs + 10,
        requests: savedWorkspace.usage.requests + 1,
      };
      database
        .prepare("UPDATE workspaces SET body = ?, updated_at = ? WHERE id = ? AND user_id = ?")
        .run(
          JSON.stringify(savedWorkspace),
          new Date().toISOString(),
          requestBody.workspaceId,
          row.user_id,
        );
      markStoppedExecutionSeen();
      await new Promise((resolve) => {
        releaseStoppedExecution = resolve;
      });
      try {
        await route.abort();
      } catch {}
    };
    await page.route("**/api/execute", simulateStopAfterCommit);
    await page.locator("#workspace-chat-input").fill("测试停止时已经保存的执行结果能否恢复");
    await page.getByRole("button", { name: "发送给 Agent" }).click();
    await stoppedExecutionSeen;
    await page.getByRole("button", { name: "停止", exact: true }).click();
    releaseStoppedExecution?.();
    await page
      .locator(".workspace-side-panel .event")
      .filter({ hasText: savedBeforeStopTitle })
      .waitFor({ state: "visible" });
    const recoveredAfterStop = await page.evaluate(async (id) => {
      const response = await fetch(`/api/workspaces/${id}`);
      return { status: response.status, ...(await response.json()) };
    }, plannedWorkspaceId);
    assert.equal(recoveredAfterStop.status, 200);
    assert.ok(
      recoveredAfterStop.workspace?.result?.events.some(
        (event) => event.title === savedBeforeStopTitle,
      ),
    );
    assert.ok(
      recoveredAfterStop.workspace?.conversation?.some(
        (message) =>
          message.role === "user" &&
          message.content.includes("测试停止时已经保存的执行结果能否恢复"),
      ),
    );
    assert.ok(
      recoveredAfterStop.workspace?.conversation?.at(-1)?.progress?.includes("正在连接 Agent…"),
    );
    check(
      true,
      "Recover committed results, user instructions, and progress when Stop wins the final SSE race",
    );
    await page.unroute("**/api/execute", simulateStopAfterCommit);

    const cancelledInstruction = "取消后确认已完成模型步骤的用量仍会记录";
    let releaseUsageOnlyExecution;
    let markUsageOnlyExecutionSeen;
    const usageOnlyExecutionSeen = new Promise((resolve) => {
      markUsageOnlyExecutionSeen = resolve;
    });
    const simulateStopAfterUsageOnly = async (route) => {
      const requestBody = route.request().postDataJSON();
      const row = database
        .prepare("SELECT body, user_id FROM workspaces WHERE id = ?")
        .get(requestBody.workspaceId);
      assert.ok(row?.body, "the active workspace must still exist before the usage-only turn");
      const savedWorkspace = JSON.parse(row.body);
      savedWorkspace.usage = {
        ...savedWorkspace.usage,
        inputTokens: savedWorkspace.usage.inputTokens + 3,
        outputTokens: savedWorkspace.usage.outputTokens + 2,
        totalTokens: savedWorkspace.usage.totalTokens + 5,
        latencyMs: savedWorkspace.usage.latencyMs + 10,
        requests: savedWorkspace.usage.requests + 1,
      };
      database
        .prepare("UPDATE workspaces SET body = ?, updated_at = ? WHERE id = ? AND user_id = ?")
        .run(
          JSON.stringify(savedWorkspace),
          new Date().toISOString(),
          requestBody.workspaceId,
          row.user_id,
        );
      markUsageOnlyExecutionSeen();
      await new Promise((resolve) => {
        releaseUsageOnlyExecution = resolve;
      });
      try {
        await route.abort();
      } catch {}
    };
    await page.route("**/api/execute", simulateStopAfterUsageOnly);
    const textarea = page.locator("#workspace-chat-input");
    await textarea.fill(cancelledInstruction);
    await page.getByRole("button", { name: "发送给 Agent" }).click();
    await usageOnlyExecutionSeen;
    await page.getByRole("button", { name: "停止", exact: true }).click();
    releaseUsageOnlyExecution?.();
    await page
      .getByRole("alert")
      .filter({ hasText: "本轮内容未提交，已完成步骤的模型用量已记录" })
      .waitFor({ state: "visible" });
    assert.equal(await textarea.inputValue(), cancelledInstruction);
    check(
      true,
      "Show completed-step usage after cancellation without clearing the user's instruction",
    );
    await page.unroute("**/api/execute", simulateStopAfterUsageOnly);
  }
  const workspaceViewport = { width: 1366, height: 768 };
  await page.setViewportSize(workspaceViewport);
  await settleViewport(page, workspaceViewport);
  const projectFlow = page.locator(".workspace-flow-panel");
  await projectFlow.waitFor({ state: "visible" });
  assert.match(await projectFlow.innerText(), /活动流程/);
  const flowCanvas = projectFlow.locator(".flow-canvas");
  assert.ok((await flowCanvas.locator(".flow-canvas-node").count()) >= 4);
  assert.match(await flowCanvas.getAttribute("aria-label"), /可拖动平移/);
  const initialCanvasTransform = await projectFlow
    .locator(".flow-canvas-board")
    .getAttribute("style");
  assert.doesNotMatch(initialCanvasTransform || "", /scale\(/);
  const canvasBounds = await flowCanvas.boundingBox();
  assert.ok(canvasBounds);
  await page.mouse.move(
    canvasBounds.x + canvasBounds.width - 14,
    canvasBounds.y + canvasBounds.height - 20,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvasBounds.x + canvasBounds.width - 54,
    canvasBounds.y + canvasBounds.height - 72,
    {
      steps: 5,
    },
  );
  await page.mouse.up();
  assert.notEqual(
    await projectFlow.locator(".flow-canvas-board").getAttribute("style"),
    initialCanvasTransform,
    "dragging the canvas must pan the project flow",
  );
  const draggedCanvasTransform = await projectFlow
    .locator(".flow-canvas-board")
    .getAttribute("style");
  await page.mouse.move(
    canvasBounds.x + canvasBounds.width / 2,
    canvasBounds.y + canvasBounds.height / 2,
  );
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(
    (previousTransform) =>
      document.querySelector(".flow-canvas-board")?.getAttribute("style") !== previousTransform,
    draggedCanvasTransform,
  );
  const pannedCanvasTransform = await projectFlow
    .locator(".flow-canvas-board")
    .getAttribute("style");
  assert.notEqual(pannedCanvasTransform, draggedCanvasTransform, "wheel input must pan the canvas");
  assert.doesNotMatch(pannedCanvasTransform || "", /scale\(/);
  assert.equal(await projectFlow.locator(".flow-canvas-toolbar").count(), 0);
  assert.equal(await projectFlow.locator(".workspace-flow-toggle").count(), 0);
  assert.equal(await page.locator(".workspace-flow-resizer").count(), 0);
  check(
    true,
    "Keep the project-flow canvas pannable at a fixed scale with no zoom or panel controls",
  );

  const primarySidebar = page.locator("#primary-sidebar");
  await page.locator(".app-shell.nav-collapsed").waitFor();
  assert.equal(await page.getByRole("button", { name: "展开导航栏" }).isVisible(), true);
  const expandSidebar = page.getByRole("button", { name: "展开导航栏" });
  await expandSidebar.click();
  await page.locator(".app-shell:not(.nav-collapsed)").waitFor();
  const sidebarWidthBeforeCollapse = await primarySidebar.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  assert.ok(sidebarWidthBeforeCollapse > 0, "the edge arrow must reveal the primary navigation");
  const collapseSidebar = page.getByRole("button", { name: "收起导航栏" });
  await collapseSidebar.click();
  await page.locator(".app-shell.nav-collapsed").waitFor();
  await page.waitForFunction(
    () => document.querySelector("#primary-sidebar")?.getBoundingClientRect().width === 0,
  );
  assert.equal(
    await projectFlow.isVisible(),
    true,
    "collapsing navigation must leave the flow panel visible",
  );
  assert.equal(await page.locator(".workspace-side-panel .execution").isVisible(), true);
  assert.equal(await page.getByRole("button", { name: "展开导航栏" }).isVisible(), true);
  check(
    true,
    "Collapse the global navigation from its edge while preserving the project workspace",
  );

  const preferenceProbe = await context.newPage();
  await preferenceProbe.goto(baseUrl.toString());
  await preferenceProbe.locator(".home-primary").waitFor({ state: "visible" });
  await preferenceProbe.getByRole("button", { name: "收起导航栏" }).click();
  await preferenceProbe.locator(".app-shell.nav-collapsed").waitFor();
  assert.equal(await preferenceProbe.getByRole("button", { name: "展开导航栏" }).isVisible(), true);
  await preferenceProbe.close();
  const preferenceReload = await context.newPage();
  await preferenceReload.goto(baseUrl.toString());
  await preferenceReload.locator(".home-primary").waitFor({ state: "visible" });
  await preferenceReload.locator(".app-shell.nav-collapsed").waitFor();
  assert.equal(
    await preferenceReload.getByRole("button", { name: "展开导航栏" }).isVisible(),
    true,
  );
  await preferenceReload.getByRole("button", { name: "展开导航栏" }).click();
  await preferenceReload.locator(".app-shell:not(.nav-collapsed)").waitFor();
  await preferenceReload.close();
  check(true, "Auto-collapse the navigation in workspaces and remember the home-page preference");

  const actionScrollport = page.locator(".workspace-side-panel .execution");
  try {
    await actionScrollport.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    const diagnostics = await page.evaluate(async (id) => {
      const response = await fetch("/api/workspaces/" + id);
      const payload = await response.json();
      const panel = document.querySelector(".workspace-side-panel");
      const execution = document.querySelector(".workspace-side-panel .execution");
      return {
        url: location.href,
        viewport: [innerWidth, innerHeight],
        workspaceVisible: Boolean(document.querySelector(".workspace")),
        flowVisible: Boolean(
          document.querySelector(".workspace-flow-panel")?.getClientRects().length,
        ),
        panelText: panel?.innerText.slice(0, 500) || "",
        executionVisible: Boolean(execution?.getClientRects().length),
        savedResult: Boolean(payload.workspace?.result),
        savedTasks: payload.workspace?.result?.tasks?.length || 0,
      };
    }, plannedWorkspaceId);
    throw new Error(
      "The action plan disappeared after navigation preference checks: " +
        JSON.stringify(diagnostics),
    );
  }
  await actionScrollport.evaluate((element) => {
    element.scrollTop = 0;
  });
  const actionScrollMetrics = await actionScrollport.evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    chain: [
      ".workspace",
      ".workspace-layout",
      ".workspace-side-panel",
      ".workspace-details",
      ".workspace-side-panel .execution",
    ].map((selector) => {
      const parent = document.querySelector(selector);
      if (!parent) return { selector, missing: true };
      const style = getComputedStyle(parent);
      const bounds = parent.getBoundingClientRect();
      return {
        selector,
        bounds: [bounds.top, bounds.bottom, bounds.height],
        cssHeight: style.height,
        minHeight: style.minHeight,
        maxHeight: style.maxHeight,
        display: style.display,
        flex: style.flex,
        overflowY: style.overflowY,
      };
    }),
  }));
  assert.equal(actionScrollMetrics.overflowY, "auto");
  assert.ok(
    actionScrollMetrics.scrollHeight > actionScrollMetrics.clientHeight,
    JSON.stringify(actionScrollMetrics),
  );
  const firstPlanTaskBounds = await page
    .locator(".workspace-side-panel .task-list button")
    .first()
    .boundingBox();
  assert.ok(firstPlanTaskBounds);
  await page.mouse.move(
    firstPlanTaskBounds.x + firstPlanTaskBounds.width / 2,
    firstPlanTaskBounds.y + firstPlanTaskBounds.height / 2,
  );
  await page.mouse.wheel(0, 360);
  await page.waitForFunction(() => {
    const scrollport = document.querySelector(".workspace-side-panel .execution");
    return Boolean(scrollport && scrollport.scrollTop > 0);
  });
  check(true, "Scroll the action plan with the mouse wheel over its task list");
  await actionScrollport.evaluate((element) => {
    element.scrollTop = 0;
  });
  assert.equal(await actionScrollport.getAttribute("role"), "region");
  assert.equal(await actionScrollport.getAttribute("aria-label"), "行动计划、任务与时间线");
  await actionScrollport.focus();
  await page.keyboard.press("PageDown");
  await page.waitForFunction(() => {
    const scrollport = document.querySelector(".workspace-side-panel .execution");
    return Boolean(scrollport && scrollport.scrollTop > 0);
  });
  check(true, "Keep the action plan keyboard-scrollable in its own panel");
  const capabilityDisclosure = page.locator(".chat-capabilities");
  await capabilityDisclosure.locator("summary").click();
  const capabilityPopover = capabilityDisclosure.locator(".chat-capabilities-popover");
  await capabilityPopover.waitFor({ state: "visible" });
  const capabilityText = await capabilityPopover.innerText();
  assert.match(capabilityText, /不用手动选择/);
  assert.match(capabilityText, /search_web/);
  assert.match(capabilityText, /generate_spreadsheet/);
  assert.match(capabilityText, /create_project/);
  assert.match(capabilityText, /演示模式/);
  const capabilityBounds = await capabilityPopover.boundingBox();
  assert.ok(capabilityBounds);
  assert.ok(capabilityBounds.x >= 0 && capabilityBounds.x + capabilityBounds.width <= 1366);
  assert.ok(capabilityBounds.y >= 0 && capabilityBounds.y + capabilityBounds.height <= 768);
  await page.screenshot({ path: path.join(screenshots, "workspace-toolbox.png") });
  check(
    true,
    "Discover automatic search, planning, file, and code tools without forcing a tool selection",
  );
  await capabilityDisclosure.locator("summary").click();
  if (liveUiMode) {
    const displayedSearchSource = page.locator(".chat-search-source");
    await displayedSearchSource.waitFor();
    assert.match(await displayedSearchSource.getAttribute("href"), /^https:\/\//);
    assert.equal(await displayedSearchSource.getAttribute("rel"), "noopener noreferrer");
    check(true, "Render source links from completed web-search tools in the conversation");
  }
  const agendaTimes = await page.locator(".timeline-date").allTextContents();
  assert.ok(
    agendaTimes.some((value) => /\d{1,2}:\d{2}/.test(value)),
    "a requested agenda must appear as concrete time slots in the workspace timeline",
  );
  check(true, "Render the generated event agenda as visible time slots");
  await assertNamedFields(page, "execution workspace");
  await assertAccessible(page, "execution workspace");
  const calendarDateDialog = page.getByRole("dialog", { name: "给相对日程一个开始日期" });
  const calendarDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出日历" }).click();
  const calendarRequiresAnchor = (await calendarDateDialog.count()) > 0;
  if (calendarRequiresAnchor) {
    await calendarDateDialog.waitFor();
    await page.waitForFunction(
      () => {
        const layer = document.querySelector(".calendar-modal")?.parentElement;
        const dialog = document.querySelector(".calendar-modal");
        return (
          Boolean(layer && dialog) &&
          Number(getComputedStyle(layer).opacity) >= 0.99 &&
          Number(getComputedStyle(dialog).opacity) >= 0.99
        );
      },
      null,
      { timeout: 3000 },
    );
    await assertNamedFields(page, "calendar date confirmation");
    await assertAccessible(page, "calendar date confirmation");
    await page.getByLabel("活动或行程开始日期").fill("2026-11-15");
    await page.getByRole("button", { name: "下载日历文件" }).click();
  }
  const calendarDownload = await calendarDownloadPromise;
  assert.match(calendarDownload.suggestedFilename(), /\.ics$/);
  const calendarDownloadPath = await calendarDownload.path();
  assert.ok(calendarDownloadPath, "the exported calendar file must be available locally");
  const calendarContent = fs.readFileSync(calendarDownloadPath, "utf8");
  assert.match(calendarContent, /BEGIN:VCALENDAR/);
  assert.match(calendarContent, /DTSTART:\d{8}T\d{6}Z/);
  const calendarEventCount = (calendarContent.match(/BEGIN:VEVENT/g) || []).length;
  const expectedCalendarEventCount = agendaTimes.filter((value) =>
    /\d{1,2}:\d{2}\s*[-–—~～至]\s*\d{1,2}:\d{2}/.test(value),
  ).length;
  assert.equal(calendarEventCount, expectedCalendarEventCount);
  assert.match(calendarContent, /SUMMARY:/);
  await page
    .getByRole("status")
    .getByText(new RegExp(`已导出 ${calendarEventCount} 个日程`))
    .waitFor();
  check(true, "Export Agent-created event times as a dated RFC 5545 calendar file");
  if (calendarRequiresAnchor) {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.getByRole("button", { name: "导出日历" }).click();
    await calendarDateDialog.waitFor();
    const calendarMobileLayout = await page.evaluate(() => {
      const dialog = document.querySelector(".calendar-modal")?.getBoundingClientRect();
      const date = document.querySelector("#calendar-anchor-date")?.getBoundingClientRect();
      const buttons = [...document.querySelectorAll(".calendar-export-form footer button")].map(
        (button) => button.getBoundingClientRect(),
      );
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        dialogFits: Boolean(dialog && dialog.left >= 0 && dialog.right <= window.innerWidth),
        dateFits: Boolean(date && date.left >= 0 && date.right <= window.innerWidth),
        buttonsFit: buttons.every(
          (bounds) => bounds.left >= 0 && bounds.right <= window.innerWidth,
        ),
      };
    });
    assert.equal(
      calendarMobileLayout.documentWidth <= 320 &&
        calendarMobileLayout.dialogFits &&
        calendarMobileLayout.dateFits &&
        calendarMobileLayout.buttonsFit,
      true,
      `calendar export must fit a 320px viewport: ${JSON.stringify(calendarMobileLayout)}`,
    );
    await page.keyboard.press("Escape");
    await calendarDateDialog.waitFor({ state: "detached" });
    assert.equal(
      await page
        .getByRole("button", { name: "导出日历" })
        .evaluate((element) => element === document.activeElement),
      true,
      "closing the calendar dialog must restore focus to its trigger",
    );
    check(true, "Keep calendar export responsive at 320px and restore focus after dismissal");
  }
  await page.setViewportSize({ width: 320, height: 720 });
  await page.waitForFunction(() => window.innerWidth === 320);
  const workflowMobileWidth = await page.evaluate(() => {
    const flow = document.querySelector(".workspace-flow-panel")?.getBoundingClientRect();
    const plan = document.querySelector(".workspace-side-panel")?.getBoundingClientRect();
    const chat = document.querySelector(".workspace-chat")?.getBoundingClientRect();
    const thinking = document.querySelector(".chat-thinking-control")?.getBoundingClientRect();
    const send = document
      .querySelector(".chat-send-button, .chat-stop-button")
      ?.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      flowRight: flow?.right ?? 0,
      planRight: plan?.right ?? 0,
      chatControlsFit:
        Boolean(chat && thinking && send) &&
        thinking.top >= chat.top &&
        thinking.bottom <= chat.bottom &&
        send.top >= chat.top &&
        send.bottom <= chat.bottom,
    };
  });
  assert.ok(
    workflowMobileWidth.document <= workflowMobileWidth.viewport &&
      workflowMobileWidth.flowRight <= workflowMobileWidth.viewport &&
      workflowMobileWidth.planRight <= workflowMobileWidth.viewport &&
      workflowMobileWidth.chatControlsFit,
    `the project flow, action plan, and chat controls must fit a 320px phone: ${JSON.stringify(workflowMobileWidth)}`,
  );
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForFunction(() => window.innerWidth === 320 && window.innerHeight === 568);
  const shortPhoneChatControlsFit = await page.evaluate(() => {
    const chat = document.querySelector(".workspace-chat")?.getBoundingClientRect();
    const thinking = document.querySelector(".chat-thinking-control")?.getBoundingClientRect();
    const send = document
      .querySelector(".chat-send-button, .chat-stop-button")
      ?.getBoundingClientRect();
    return (
      Boolean(chat && thinking && send) &&
      thinking.top >= chat.top &&
      thinking.bottom <= chat.bottom &&
      send.top >= chat.top &&
      send.bottom <= chat.bottom
    );
  });
  assert.equal(
    shortPhoneChatControlsFit,
    true,
    "the thinking and send controls must remain inside the chat card at 320×568",
  );
  const mobileChatFileInput = page.locator('.chat-attach-button input[type="file"]');
  await mobileChatFileInput.setInputFiles(
    Array.from({ length: 6 }, (_, index) => ({
      name: `比赛参考资料与执行约束 - 第 ${index + 1} 份.md`,
      mimeType: "text/markdown",
      buffer: Buffer.from(`手机端附件布局验收资料 ${index + 1}`, "utf8"),
    })),
  );
  await page.waitForFunction(() => document.querySelectorAll(".chat-attachment-chip").length === 6);
  const multiAttachmentComposerFit = await page.evaluate(() => {
    const chat = document.querySelector(".workspace-chat")?.getBoundingClientRect();
    const thinking = document.querySelector(".chat-thinking-control")?.getBoundingClientRect();
    const send = document
      .querySelector(".chat-send-button, .chat-stop-button")
      ?.getBoundingClientRect();
    return {
      fit:
        Boolean(chat && thinking && send) &&
        thinking.top >= chat.top &&
        thinking.bottom <= chat.bottom &&
        send.top >= chat.top &&
        send.bottom <= chat.bottom,
      chat: chat && { top: chat.top, bottom: chat.bottom, height: chat.height },
      thinking: thinking && { top: thinking.top, bottom: thinking.bottom, height: thinking.height },
      send: send && { top: send.top, bottom: send.bottom, height: send.height },
      attachmentList: (() => {
        const list = document.querySelector(".chat-attachment-list");
        return (
          list && { height: list.getBoundingClientRect().height, scrollHeight: list.scrollHeight }
        );
      })(),
    };
  });
  assert.equal(
    multiAttachmentComposerFit.fit,
    true,
    `all six mobile chat attachments must leave the thinking and send controls inside the chat card: ${JSON.stringify(multiAttachmentComposerFit)}`,
  );
  const mobileAttachmentRemoveButtons = page.locator(".chat-attachment-chip button");
  for (let index = 0; index < 6; index += 1) await mobileAttachmentRemoveButtons.first().click();
  await page.waitForFunction(() => document.querySelectorAll(".chat-attachment-chip").length === 0);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.waitForFunction(() => window.innerWidth === 320 && window.innerHeight === 720);
  const mobileToolbox = page.locator(".chat-capabilities");
  await mobileToolbox.scrollIntoViewIfNeeded();
  await mobileToolbox.locator("summary").click();
  const mobileToolboxBounds = await mobileToolbox
    .locator(".chat-capabilities-popover")
    .boundingBox();
  const mobileToolboxColumns = await mobileToolbox
    .locator(".chat-capabilities-grid")
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  assert.ok(mobileToolboxBounds);
  assert.ok(
    mobileToolboxBounds.x >= 0 && mobileToolboxBounds.x + mobileToolboxBounds.width <= 320,
    `the tool catalog must fit a 320px phone: ${JSON.stringify(mobileToolboxBounds)}`,
  );
  assert.equal(mobileToolboxColumns, 1);
  await mobileToolbox.locator("summary").click();
  await page.screenshot({
    path: path.join(screenshots, "mobile-project-flow.png"),
    fullPage: true,
  });
  check(
    true,
    "Keep the chat send and thinking controls, project flow, action plan, and tool catalog usable on a 320px phone",
  );
  check(true, "Keep the chat composer usable on a short 320×568 phone viewport");
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForFunction(() => window.innerWidth === 768);
  const tabletExecutionLayout = await page.evaluate(() => {
    const execution = document.querySelector(".execution");
    const flow = document.querySelector(".workspace-flow-panel");
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      executionWidth: execution?.clientWidth ?? 0,
      executionScrollWidth: execution?.scrollWidth ?? 0,
      internalToolHistoryAbsent: !document.querySelector(".execution-side"),
      flowVisible: Boolean(flow && getComputedStyle(flow).display !== "none"),
    };
  });
  assert.equal(
    tabletExecutionLayout.documentWidth <= tabletExecutionLayout.viewportWidth,
    true,
    `tablet execution must not overflow the page: ${JSON.stringify(tabletExecutionLayout)}`,
  );
  assert.equal(
    tabletExecutionLayout.executionScrollWidth <= tabletExecutionLayout.executionWidth,
    true,
    `tablet action plan must fit its container: ${JSON.stringify(tabletExecutionLayout)}`,
  );
  assert.equal(tabletExecutionLayout.internalToolHistoryAbsent, true);
  assert.equal(tabletExecutionLayout.flowVisible, true);
  await page.screenshot({ path: path.join(screenshots, "tablet-execution.png"), fullPage: true });
  check(true, "Keep project flow and action plan usable at tablet widths");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(() => window.innerWidth === 1440);
  await page.locator(".task-list button").first().click();
  await page.waitForFunction(() => {
    const task = document.querySelector(".task-list button");
    return task?.getAttribute("aria-pressed") === "true";
  });
  if (liveUiMode) {
    const usageStrip = page.locator(".workspace-plan-usage");
    await usageStrip.waitFor({ state: "visible" });
    const displayedUsage = await usageStrip.innerText();
    assert.match(displayedUsage, /deepseek-flash/);
    assert.match(displayedUsage, /tokens/);
    const totalTokens = Number(displayedUsage.match(/[\d,]+(?= tokens)/)?.[0]?.replaceAll(",", ""));
    assert.ok(
      totalTokens > livePlanUsage.totalTokens,
      "cumulative usage must include planning and execution",
    );
    check(true, "Show real provider token usage and latency beside the action plan");
    const requestsBeforeContinuation = Number(
      displayedUsage.match(/([\d,]+) 次请求/)?.[1]?.replaceAll(",", ""),
    );
    await page.route("**/api/execute", async (route) => {
      const body = route.request().postDataJSON();
      if (!body.continuation) return route.continue();
      const result = {
        summary: "已根据补充指示新增胸牌制作任务。",
        tasks: [
          ...body.currentTasks,
          {
            id: "ui-smoke-follow-up-task",
            title: "制作并打印志愿者姓名胸牌",
            detail: "按现场分工打印并核对胸牌。",
            phase: "执行",
            status: "pending",
          },
        ],
        milestones: body.currentMilestones,
        artifacts: [],
        events: [
          {
            id: "ui-smoke-follow-up-event",
            name: "create_tasks",
            title: "任务已建立",
            detail: "新增 1 项任务",
            status: "done",
          },
        ],
        usage: {
          model: "deepseek-flash",
          inputTokens: 100,
          outputTokens: 40,
          totalTokens: 140,
          latencyMs: 42,
          requests: 1,
        },
      };
      if (body.currentBudget) result.budget = body.currentBudget;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result, mode: "live" }),
      });
    });
    await page
      .locator("#workspace-chat-input")
      .fill("请只新增一项任务：制作并打印志愿者姓名胸牌。不要改动现有任务与日程。");
    await page.getByRole("button", { name: "发送给 Agent", exact: true }).click();
    await page.waitForFunction((previousTotal) => {
      const text = document.querySelector(".workspace-plan-usage")?.textContent || "";
      const currentTotal = Number(text.match(/[\d,]+(?= tokens)/)?.[0]?.replaceAll(",", ""));
      return currentTotal > previousTotal;
    }, totalTokens);
    const continuedUsage = await usageStrip.innerText();
    const requestsAfterContinuation = Number(
      continuedUsage.match(/([\d,]+) 次请求/)?.[1]?.replaceAll(",", ""),
    );
    assert.ok(requestsAfterContinuation > requestsBeforeContinuation);
    assert.match(await page.locator(".task-list").innerText(), /胸牌/);
    await page.unroute("**/api/execute");
    check(true, "Accumulate a follow-up Agent call in target usage and execute its specific task");
  } else {
    assert.equal(
      await page.locator(".usage-strip").count(),
      0,
      "demo execution must not display fabricated provider usage",
    );
    check(true, "Do not invent provider usage in the demo Agent panel");
  }
  if (!liveUiMode) {
    const beforeDemoFollowUpTasks = await page.locator(".task-list button").count();
    const resultBeforeProgressQuestion = await page.evaluate(async (id) => {
      const response = await fetch(`/api/workspaces/${id}`);
      return (await response.json()).workspace?.result;
    }, plannedWorkspaceId);
    await page.locator("#workspace-chat-input").fill("这个项目现在到哪里了？");
    await page.getByRole("button", { name: "发送给 Agent", exact: true }).click();
    await page
      .locator(".workspace-chat-thread")
      .getByText(/当前没有任务在后台运行/)
      .waitFor({ state: "visible" });
    const resultAfterProgressQuestion = await page.evaluate(async (id) => {
      const response = await fetch(`/api/workspaces/${id}`);
      return (await response.json()).workspace?.result;
    }, plannedWorkspaceId);
    assert.equal(
      resultAfterProgressQuestion?.events.length,
      resultBeforeProgressQuestion?.events.length,
      "a project status question must be answered by the dialog agent without adding workbench events",
    );
    assert.equal(await page.locator(".task-list button").count(), beforeDemoFollowUpTasks);
    check(true, "Answer a progress question directly without invoking the workbench agent");

    const demoTaskTitle = "收集参会反馈并整理改进点";
    await page.locator("#workspace-chat-input").fill(`新增一个任务：${demoTaskTitle}`);
    await page.getByRole("button", { name: "发送给 Agent", exact: true }).click();
    await page.locator(".task-list").getByText(demoTaskTitle, { exact: true }).waitFor();
    await page.waitForFunction(async (title) => {
      const response = await fetch("/api/workspaces");
      if (!response.ok) return false;
      const data = await response.json();
      return data.workspaces.some((workspace) =>
        workspace.result?.tasks?.some((task) => task.title === title),
      );
    }, demoTaskTitle);
    assert.equal(await page.locator(".task-list button").count(), beforeDemoFollowUpTasks + 1);
    const demoFollowUpState = await page.evaluate(async (id) => {
      const response = await fetch(`/api/workspaces/${id}`);
      const data = await response.json();
      return data.workspace?.result;
    }, plannedWorkspaceId);
    assert.equal(demoFollowUpState.events.at(-1)?.name, "create_tasks");
    check(true, "Hand an explicit task request from the dialog agent to workbench execution");
    assert.equal(demoFollowUpState.usage, undefined);
    assert.match(demoFollowUpState.summary, /没有调用模型/);
    await page.locator("#workspace-chat-input").fill(`新增一个任务：${demoTaskTitle}`);
    await page.locator(".workspace-chat .chat-send-button").click();
    await page
      .waitForFunction(
        async ({ id, title }) => {
          const response = await fetch(`/api/workspaces/${id}`);
          if (!response.ok) return false;
          const data = await response.json();
          return data.workspace?.result?.events
            ?.at(-1)
            ?.detail?.includes(`已有同名任务「${title}」`);
        },
        { id: plannedWorkspaceId, title: demoTaskTitle },
      )
      .catch(async (error) => {
        const diagnostics = await page.evaluate(async (id) => {
          const response = await fetch(`/api/workspaces/${id}`);
          const data = await response.json();
          return {
            events: data.workspace?.result?.events?.slice(-4),
            taskCount: data.workspace?.result?.tasks?.length,
            footer: document.querySelector(".workspace-chat-composer-footer")?.textContent,
            thread: document.querySelector(".workspace-chat-thread")?.textContent?.slice(-1200),
          };
        }, plannedWorkspaceId);
        console.error("Duplicate-task UI diagnostics:", JSON.stringify(diagnostics));
        throw error;
      });
    assert.equal(await page.locator(".task-list button").count(), beforeDemoFollowUpTasks + 1);
    const noteInstruction = "请把方案补充风险预案和主持人提醒。";
    await page.locator("#workspace-chat-input").fill(noteInstruction);
    await page.waitForFunction(() => {
      const send = document.querySelector(".workspace-chat .chat-send-button");
      return Boolean(send && !send.hasAttribute("disabled"));
    });
    await page.locator(".workspace-chat .chat-send-button").click();
    await page.waitForFunction(
      async ({ id, note }) => {
        const response = await fetch(`/api/workspaces/${id}`);
        if (!response.ok) return false;
        const data = await response.json();
        return data.workspace?.result?.events?.some(
          (event) =>
            event.name === "record_instruction" && event.detail === `${note}（未调用模型）`,
        );
      },
      { id: plannedWorkspaceId, note: noteInstruction },
    );
    let completedDemoHandoff;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      completedDemoHandoff = database
        .prepare(
          "SELECT status FROM workbench_handoffs WHERE workspace_id = ? AND instruction = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(plannedWorkspaceId, noteInstruction);
      if (completedDemoHandoff?.status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 125));
    }
    assert.equal(
      completedDemoHandoff?.status,
      "completed",
      "the server should persist and finish the dialog-to-workbench handoff",
    );
    const unrecognizedDemoState = await page.evaluate(async (id) => {
      const response = await fetch(`/api/workspaces/${id}`);
      const data = await response.json();
      return { result: data.workspace?.result, conversation: data.workspace?.conversation };
    }, plannedWorkspaceId);
    assert.equal(unrecognizedDemoState.result.tasks.length, beforeDemoFollowUpTasks + 1);
    assert.equal(unrecognizedDemoState.result.usage, undefined);
    assert.match(
      unrecognizedDemoState.result.events.at(-1)?.detail || "",
      /未调用模型/,
      `unsupported demo follow-up should be saved as a note: ${JSON.stringify({ events: unrecognizedDemoState.result.events.slice(-4), messages: unrecognizedDemoState.conversation.slice(-8), handoffs: database.prepare("SELECT id, status, instruction, user_message_id FROM workbench_handoffs WHERE workspace_id = ?").all(plannedWorkspaceId) })}`,
    );
    check(
      true,
      "Simulate demo tasks, prevent duplicates, and record unsupported changes without fake usage",
    );
  }
  const executionFrame = await page.evaluate(() => ({
    documentHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    projectFlowInLeftPanel: Boolean(document.querySelector(".workspace-flow-panel")),
    actionPlanInRightPanel: Boolean(document.querySelector(".workspace-side-panel .execution")),
    chatInCenter: Boolean(document.querySelector(".workspace-chat")),
    internalToolHistoryAbsent: !document.querySelector(".execution-side"),
    toolMapInSidePanel: Boolean(
      document.querySelector(".workspace-side-panel .agent-flow-section"),
    ),
    conversationThreadCanScroll:
      (document.querySelector(".workspace-chat-thread")?.scrollHeight ?? 0) >=
      (document.querySelector(".workspace-chat-thread")?.clientHeight ?? 0),
    layoutHeight: document.querySelector(".workspace-layout")?.clientHeight ?? 0,
  }));
  assert.ok(
    executionFrame.documentHeight <= executionFrame.viewportHeight,
    JSON.stringify(executionFrame),
  );
  assert.equal(executionFrame.projectFlowInLeftPanel, true);
  assert.equal(executionFrame.actionPlanInRightPanel, true);
  assert.equal(executionFrame.chatInCenter, true);
  assert.equal(executionFrame.internalToolHistoryAbsent, true);
  assert.equal(executionFrame.toolMapInSidePanel, false);
  assert.ok(executionFrame.layoutHeight > 0);
  check(true, "Fit the left project flow, center chat, and right action plan in one desktop frame");
  for (const viewport of [
    { width: 1366, height: 768 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await settleViewport(page, viewport);
    const laptopFrame = await page.evaluate(() => {
      const bounds = (selector) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { top: rect.top, right: rect.right, bottom: rect.bottom, height: rect.height };
      };
      const execution = document.querySelector(".workspace-side-panel .execution");
      const flow = document.querySelector(".workspace-flow-panel");
      const chat = document.querySelector(".workspace-chat");
      const thread = document.querySelector(".workspace-chat-thread");
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        documentHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        topbar: bounds(".topbar"),
        workspaceHead: bounds(".workspace-head"),
        layout: bounds(".workspace-layout"),
        chat: bounds(".workspace-chat"),
        composer: bounds(".workspace-chat-composer"),
        sidePanel: bounds(".workspace-side-panel"),
        flowPanel: bounds(".workspace-flow-panel"),
        flowBeforeChat: Boolean(
          flow && chat && flow.getBoundingClientRect().right <= chat.getBoundingClientRect().left,
        ),
        chatBeforePlan: Boolean(
          chat &&
          document.querySelector(".workspace-side-panel") &&
          chat.getBoundingClientRect().right <=
            document.querySelector(".workspace-side-panel").getBoundingClientRect().left,
        ),
        threadOverflow: thread ? getComputedStyle(thread).overflowY : "missing",
        threadHeight: thread?.clientHeight ?? 0,
        executionOverflow: execution ? getComputedStyle(execution).overflowY : "missing",
        executionScrollHeight: execution?.scrollHeight ?? 0,
        executionClientHeight: execution?.clientHeight ?? 0,
      };
    });
    assert.ok(laptopFrame.documentWidth <= laptopFrame.viewportWidth, JSON.stringify(laptopFrame));
    assert.ok(
      laptopFrame.documentHeight <= laptopFrame.viewportHeight,
      JSON.stringify(laptopFrame),
    );
    assert.ok(
      laptopFrame.topbar && Math.abs(laptopFrame.topbar.top) < 1,
      JSON.stringify(laptopFrame),
    );
    assert.ok(
      laptopFrame.workspaceHead &&
        laptopFrame.layout &&
        laptopFrame.workspaceHead.bottom <= laptopFrame.layout.top,
      JSON.stringify(laptopFrame),
    );
    assert.ok(
      laptopFrame.chat &&
        laptopFrame.composer &&
        laptopFrame.chat.bottom <= laptopFrame.viewportHeight &&
        laptopFrame.composer.bottom <= laptopFrame.chat.bottom,
      JSON.stringify(laptopFrame),
    );
    assert.ok(
      laptopFrame.sidePanel &&
        laptopFrame.flowPanel &&
        laptopFrame.sidePanel.bottom <= laptopFrame.viewportHeight &&
        laptopFrame.executionOverflow === "auto" &&
        laptopFrame.executionScrollHeight > laptopFrame.executionClientHeight,
      JSON.stringify(laptopFrame),
    );
    assert.equal(laptopFrame.flowBeforeChat, true, JSON.stringify(laptopFrame));
    assert.equal(laptopFrame.chatBeforePlan, true, JSON.stringify(laptopFrame));
    assert.equal(laptopFrame.threadOverflow, "auto");
    assert.ok(laptopFrame.threadHeight > 100);
    await page.screenshot({
      path: path.join(
        screenshots,
        "workspace-laptop-" + viewport.width + "x" + viewport.height + ".png",
      ),
    });
    check(
      true,
      "Keep the workspace fixed and readable at " + viewport.width + "×" + viewport.height,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: path.join(screenshots, "workspace-execution.png"),
    fullPage: true,
  });
  check(
    true,
    liveUiMode
      ? "Execute the live Agent workflow and persist a completed task"
      : "Execute the demo workflow and persist a completed task",
  );
  await page.getByRole("button", { name: "共享工作区", exact: true }).click();
  const shareDialog = page.getByRole("dialog", { name: "邀请成员协作" });
  await shareDialog.waitFor({ state: "visible" });
  await page.waitForFunction(
    (dialog) => getComputedStyle(dialog).opacity === "1",
    await shareDialog.elementHandle(),
  );
  await assertAccessible(page, "workspace sharing dialog");
  await shareDialog.getByLabel("成员权限").selectOption("viewer");
  await shareDialog.getByRole("button", { name: "生成邀请链接" }).click();
  const generatedShareInput = shareDialog.locator("#generated-share-url");
  await generatedShareInput.waitFor({ state: "visible" });
  const generatedShareUrl = await generatedShareInput.inputValue();
  assert.match(generatedShareUrl, /\/invite\/[A-Za-z0-9_-]+$/);
  await page.screenshot({ path: path.join(screenshots, "workspace-sharing-dialog.png") });
  const inviteContext = await browser.newContext({
    viewport: { width: 960, height: 760 },
    reducedMotion: "reduce",
    extraHTTPHeaders: { "X-Forwarded-For": smokeClientAddress },
  });
  const invitePage = await inviteContext.newPage();
  const inviteErrors = [];
  invitePage.on("pageerror", (error) => inviteErrors.push(error));
  await invitePage.goto(generatedShareUrl, { waitUntil: "networkidle" });
  await invitePage.getByRole("heading", { name: "加入一个协作工作区" }).waitFor();
  await assertAccessible(invitePage, "workspace invite page");
  await invitePage.getByRole("button", { name: "接受邀请" }).click();
  await invitePage.getByRole("alert").getByText("请登录后再接受工作区邀请。").waitFor();
  await invitePage.getByRole("link", { name: "在新标签页登录或注册" }).waitFor();
  assert.deepEqual(inviteErrors, []);
  await invitePage.screenshot({ path: path.join(screenshots, "workspace-invite-page.png") });
  await inviteContext.close();
  const revokeShareButton = page.locator('button[aria-label="撤销邀请链接"]');
  try {
    await revokeShareButton.waitFor({ state: "visible", timeout: 8_000 });
  } catch {
    const shareDiagnostics = await page.locator('[role="dialog"]').evaluateAll((dialogs) =>
      dialogs.map((dialog) => ({
        visible: Boolean(dialog.getClientRects().length),
        buttons: [...dialog.querySelectorAll("button")].map((button) => ({
          label: button.getAttribute("aria-label") || "",
          text: button.innerText,
        })),
        linkRows: dialog.querySelectorAll(".share-list-row").length,
      })),
    );
    throw new Error(
      "Invite was created but its revoke control was not available: " +
        JSON.stringify(shareDiagnostics),
    );
  }
  await revokeShareButton.click();
  await shareDialog.getByText("暂时没有有效邀请链接。").waitFor();
  await shareDialog.getByRole("button", { name: "关闭共享设置" }).click();
  await shareDialog.waitFor({ state: "hidden" });
  check(
    true,
    "Create and revoke a read-only invite and keep the invite page accessible and private",
  );
  const persistedExecutionProgress = await page.evaluate(async (id) => {
    const response = await fetch(`/api/workspaces/${id}`);
    const payload = await response.json();
    const assistant = [...(payload.workspace?.conversation || [])]
      .reverse()
      .find((message) => message.role === "assistant" && Array.isArray(message.progress));
    return { progress: assistant?.progress || [], summary: assistant?.content || "" };
  }, plannedWorkspaceId);
  assert.ok(persistedExecutionProgress.progress.length > 0);
  assert.ok(persistedExecutionProgress.progress.length <= 12);
  const workbenchAuthor = page.locator(
    '.workspace-chat-thread .chat-message[data-agent="workbench"] .chat-message-author',
  );
  await workbenchAuthor.last().waitFor({ state: "visible" });
  assert.equal(await workbenchAuthor.last().innerText(), "工作台 Agent");
  const completedProgress = page.locator(".workspace-live-progress.completed");
  await completedProgress.waitFor({ state: "visible" });
  assert.match(await completedProgress.innerText(), /本轮执行完成/);
  check(
    true,
    "Keep a clear completion status visible and compact progress saved in workspace history",
  );
  try {
    await page.waitForFunction(
      () => {
        const thread = document.querySelector(".workspace-chat-thread");
        const message = thread?.querySelectorAll(".chat-message.chat-agent");
        const latest = message?.[message.length - 1];
        const shelf = thread?.querySelector(".chat-artifact-shelf > summary");
        if (!thread || !latest || !shelf) return false;
        const viewport = thread.getBoundingClientRect();
        const reply = latest.getBoundingClientRect();
        const artifacts = shelf.getBoundingClientRect();
        return (
          thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 2 &&
          reply.bottom >= viewport.top - 2 &&
          reply.bottom <= viewport.bottom + 2 &&
          artifacts.bottom <= viewport.bottom + 2
        );
      },
      undefined,
      { timeout: 3000 },
    );
  } catch (error) {
    const scrollDiagnostics = await page.evaluate(() => {
      const thread = document.querySelector(".workspace-chat-thread");
      if (!thread) return { thread: null };
      const message = [...thread.querySelectorAll(".chat-message.chat-agent")].at(-1);
      const rect = (element) => {
        if (!element) return null;
        const bounds = element.getBoundingClientRect();
        return { top: bounds.top, bottom: bounds.bottom, height: bounds.height };
      };
      return {
        thread: rect(thread),
        scrollTop: thread.scrollTop,
        scrollHeight: thread.scrollHeight,
        clientHeight: thread.clientHeight,
        latestMessage: rect(message),
        latestText: message?.innerText.slice(0, 300),
        childCount: thread.children.length,
      };
    });
    console.error("Workspace chat scroll diagnostics:", JSON.stringify(scrollDiagnostics));
    throw error;
  }
  check(true, "Keep the newest Agent reply visible beside a compact generated-files shelf");
  const artifactShelf = page.locator(".chat-artifact-shelf");
  assert.equal(await artifactShelf.evaluate((element) => element.open), false);
  const shelfSummary = artifactShelf.locator("summary");
  const shelfHitTest = await shelfSummary.evaluate((summary) => {
    const bounds = summary.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    const hit = document.elementFromPoint(x, y);
    return hit === summary || summary.contains(hit);
  });
  assert.equal(shelfHitTest, true, "the generated-files summary must receive pointer input");
  await shelfSummary.click();
  await artifactShelf.locator("button").first().waitFor({ state: "visible" });
  check(true, "Expand generated files on demand without crowding the conversation by default");

  const [workspaceDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出完整工作区" }).click(),
  ]);
  assert.match(workspaceDownload.suggestedFilename(), /\.md$/);
  const workspaceMarkdown = fs.readFileSync(await workspaceDownload.path(), "utf8");
  for (const section of [
    "## 原始目标",
    "## 执行路线",
    "## 任务清单",
    "## 推进时间线",
    "## Agent 运行记录",
    "### 对话执行阶段",
    "## 模型调用用量",
    "## 生成的产物",
  ]) {
    assert.ok(workspaceMarkdown.includes(section), `workspace export must include ${section}`);
  }
  if (liveUiMode) {
    assert.match(
      workspaceMarkdown,
      /## 模型调用用量[\s\S]*?- 模型：deepseek-flash[\s\S]*?- Tokens：输入 [\d,]+ · 输出 [\d,]+ · 合计 [\d,]+/,
    );
  } else {
    assert.match(workspaceMarkdown, /演示模式不会生成虚构用量/);
  }
  assert.match(workspaceMarkdown, /UI smoke edit|初版方案/);
  check(true, "Download a complete Markdown archive with routes, progress, events, and artifacts");

  await page
    .locator(".chat-artifacts button")
    .filter({ hasText: /方案|策划|计划/ })
    .first()
    .click();
  const artifactDialog = page.getByRole("dialog");
  await artifactDialog.waitFor({ state: "visible" });
  const artifactMarkdownFixture = [
    "## 执行方案",
    "",
    "**核心目标：** _按任务清单_ 完成准备、~~临时项~~、现场执行和 `recap`。参见[执行规范](https://example.com/guide)。",
    "",
    "1. 确认负责人与时段",
    "2. 完成执行与复盘",
    "",
    "- 发送确认信息",
    "",
    "| 阶段 | 交付物 |",
    "| --- | --- |",
    "| 准备 | 清单 |",
    "| 复盘 | 记录 |",
    "",
    "> 保持确认信息清楚。",
    "",
    "```ts",
    "const ready = true;",
    "```",
  ].join("\n");
  await artifactDialog.getByRole("button", { name: "编辑方案" }).click();
  await artifactDialog.getByLabel("编辑方案内容").fill(artifactMarkdownFixture);
  await artifactDialog.getByRole("button", { name: "保存修改" }).click();
  await artifactDialog.locator(".artifact-editor").waitFor({ state: "detached" });
  const originalArtifactContent = await page.evaluate(async (id) => {
    const response = await fetch(`/api/workspaces/${id}`);
    const payload = await response.json();
    return (
      payload.workspace?.result?.artifacts.find((item) => item.type === "document")?.content || ""
    );
  }, plannedWorkspaceId);
  assert.ok(originalArtifactContent, "the demo workspace must contain the generated document");
  assert.equal(originalArtifactContent, artifactMarkdownFixture);
  const documentPreview = artifactDialog.locator(".artifact-document-preview");
  await documentPreview.waitFor({ state: "visible" });
  assert.ok(await documentPreview.locator("h1, h2, h3").count());
  assert.ok(await documentPreview.locator("p").count());
  assert.ok(await documentPreview.locator("ol li").count());
  assert.ok(await documentPreview.locator("table tbody tr").count());
  assert.ok(await documentPreview.locator("strong").count());
  assert.ok(await documentPreview.locator("ul li").count());
  assert.ok(await documentPreview.locator("blockquote").count());
  assert.ok(await documentPreview.locator("pre code").count());
  assert.ok(await documentPreview.locator("a[href^='https://']").count());
  const markdownColors = await documentPreview.evaluate((element) => {
    const colorOf = (selector) => {
      const node = element.querySelector(selector);
      return node ? getComputedStyle(node).color : "";
    };
    const backgroundOf = (selector, fallback) => {
      const node = element.querySelector(selector);
      return node ? getComputedStyle(node).backgroundColor : fallback;
    };
    const articleBackground = getComputedStyle(element).backgroundColor;
    const codeBlock = element.querySelector("pre code");
    return {
      articleBackground,
      heading: colorOf("h1, h2, h3"),
      paragraph: colorOf("p"),
      link: colorOf("a"),
      inlineCode: colorOf("p code"),
      inlineCodeBackground: backgroundOf("p code", articleBackground),
      codeBlock: codeBlock ? getComputedStyle(codeBlock).color : "",
      codeBlockBackground: codeBlock
        ? getComputedStyle(codeBlock.parentElement).backgroundColor
        : articleBackground,
    };
  });
  for (const [label, foreground, background] of [
    ["heading", markdownColors.heading, markdownColors.articleBackground],
    ["paragraph", markdownColors.paragraph, markdownColors.articleBackground],
    ["link", markdownColors.link, markdownColors.articleBackground],
    ["inline code", markdownColors.inlineCode, markdownColors.inlineCodeBackground],
    ["code block", markdownColors.codeBlock, markdownColors.codeBlockBackground],
  ]) {
    assert.ok(
      contrastRatio(foreground, background) >= 4.5,
      `Markdown ${label} contrast is below WCAG AA: ${foreground} on ${background}`,
    );
  }
  check(true, "Keep Markdown headings, text, links, and code readable on their preview surfaces");
  const previewScroll = await documentPreview.evaluate((element) => {
    const canScroll = element.scrollHeight > element.clientHeight;
    element.scrollTop = element.scrollHeight;
    return {
      canScroll,
      reachedEnd: element.scrollTop + element.clientHeight >= element.scrollHeight,
    };
  });
  assert.ok(
    previewScroll.canScroll && previewScroll.reachedEnd,
    "long artifact previews remain readable in their own scroll area",
  );
  await documentPreview.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.waitForFunction(() => {
    const modal = document.querySelector(".artifact-modal");
    return modal !== null && Number(getComputedStyle(modal).opacity) >= 0.99;
  });
  await page.screenshot({ path: path.join(screenshots, "document-preview.png") });
  check(
    true,
    "Render generated documents as structured, readable previews instead of raw Markdown",
  );
  await artifactDialog.getByRole("button", { name: "复制内容" }).click();
  await artifactDialog.getByRole("status").getByText("方案内容已复制到剪贴板。").waitFor();
  assert.equal(
    (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n?/g, "\n"),
    originalArtifactContent.replace(/\r\n?/g, "\n"),
  );
  const artifactDownloadPromise = page.waitForEvent("download", { timeout: 10_000 });
  await artifactDialog.getByRole("button", { name: /下载 Word \(\.docx\)/ }).click();
  let artifactDownload;
  try {
    artifactDownload = await artifactDownloadPromise;
  } catch {
    const exportStatus = await artifactDialog
      .locator(".artifact-action-status")
      .innerText()
      .catch(() => "没有显示导出状态");
    throw new Error(`Word 导出未触发下载：${exportStatus}`);
  }
  assert.match(artifactDownload.suggestedFilename(), /\.docx$/);
  const docxArchive = await JSZip.loadAsync(fs.readFileSync(await artifactDownload.path()));
  const exportedWordXml = await docxArchive.file("word/document.xml").async("string");
  assert.match(exportedWordXml, /策划|活动|执行方案/);
  assert.match(
    exportedWordXml,
    /<w:tbl[\s>]/,
    "Word export preserves Markdown tables as editable Word tables",
  );
  assert.match(exportedWordXml, /<w:b\/>/, "Word export preserves bold inline emphasis");
  assert.match(exportedWordXml, /<w:i\/>/, "Word export preserves italic inline emphasis");
  assert.match(
    exportedWordXml,
    /<w:strike\/>/,
    "Word export preserves strikethrough inline emphasis",
  );
  assert.match(exportedWordXml, /<w:hyperlink[\s>]/, "Word export preserves clickable links");
  assert.match(exportedWordXml, /Consolas/, "Word export preserves monospace code formatting");
  const exportedWordText = exportedWordXml
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  assert.ok(
    exportedWordText.includes("1. 确认负责人与时段"),
    "Word export preserves ordered list numbering",
  );
  await artifactDialog.getByRole("status").getByText("Word 文档已开始下载。").waitFor();
  check(true, "Copy and download artifact contents with clear feedback");
  if (!liveUiMode) {
    assert.ok(injectedDemoArtifacts);
    await page
      .locator(".chat-artifacts button")
      .filter({ hasText: "UI Smoke Starter Project" })
      .waitFor();
  }
  {
    await artifactDialog.getByRole("button", { name: "关闭产物" }).click();
    const downloadFixture = async (title, buttonName, extension) => {
      await page.locator(".chat-artifacts button").filter({ hasText: title }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ state: "visible" });
      const downloadPromise = page.waitForEvent("download", { timeout: 15_000 });
      await dialog.getByRole("button", { name: buttonName }).click();
      const download = await downloadPromise;
      assert.match(download.suggestedFilename(), new RegExp("\\." + extension + "$"));
      const archive = await JSZip.loadAsync(fs.readFileSync(await download.path()), {
        checkCRC32: true,
      });
      await dialog.getByRole("button", { name: "关闭产物" }).click();
      await dialog.waitFor({ state: "hidden" });
      return archive;
    };

    await page
      .locator(".chat-artifacts button")
      .filter({ hasText: "UI Smoke Starter Project" })
      .click();
    const projectDialog = page.getByRole("dialog");
    await projectDialog.waitFor({ state: "visible" });
    const previewFrame = projectDialog.locator('iframe[title="UI Smoke Starter Project 网页预览"]');
    await previewFrame.waitFor({ state: "visible" });
    assert.equal(await previewFrame.getAttribute("sandbox"), "");
    const preview = await previewFrame.contentFrame();
    assert.ok(preview);
    await preview.getByRole("heading", { name: "Local preview ready" }).waitFor();
    const safePreviewState = await preview.locator("body").evaluate(() => ({
      scriptCount: document.scripts.length,
      refreshMeta: document.querySelector('meta[http-equiv="refresh"]') !== null,
      externalLinkHasHref: document.querySelector("a")?.hasAttribute("href") ?? false,
      probeHasNoLoadedImage: document.querySelector("#external-probe")?.naturalWidth === 0,
      headingColor: getComputedStyle(document.querySelector("h1")).color,
      policy: document
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute("content"),
    }));
    assert.equal(safePreviewState.scriptCount, 0);
    assert.equal(safePreviewState.refreshMeta, false);
    assert.equal(safePreviewState.externalLinkHasHref, false);
    assert.equal(safePreviewState.probeHasNoLoadedImage, true);
    assert.equal(safePreviewState.headingColor, "rgb(89, 57, 135)");
    assert.match(safePreviewState.policy || "", /connect-src 'none'/);
    assert.match(safePreviewState.policy || "", /default-src 'none'/);
    assert.match(safePreviewState.policy || "", /script-src 'none'/);
    assert.match(safePreviewState.policy || "", /script-src-attr 'none'/);
    await preview.getByRole("button", { name: "Local action" }).click();
    await preview.locator("#external-probe").evaluate(
      (image) =>
        new Promise((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        }),
    );
    const previewHandlerState = await preview.locator("body").evaluate((body) => ({
      inlineClickRan: body.dataset.inlineClick === "ran",
      inlineErrorRan: body.dataset.inlineError === "ran",
    }));
    assert.deepEqual(previewHandlerState, { inlineClickRan: false, inlineErrorRan: false });
    check(true, "Block inline preview handlers and remote image loads inside the static sandbox");
    await page.waitForFunction(() => {
      const modal = document.querySelector(".artifact-modal");
      return modal !== null && Number(getComputedStyle(modal).opacity) >= 0.99;
    });
    const desktopCodeModal = await projectDialog.evaluate((modal) => {
      const bounds = modal.getBoundingClientRect();
      const footer = modal.querySelector("footer");
      const footerBounds = footer?.getBoundingClientRect();
      return {
        viewportHeight: window.innerHeight,
        top: bounds.top,
        bottom: bounds.bottom,
        scrollHeight: modal.scrollHeight,
        clientHeight: modal.clientHeight,
        footerBottom: footerBounds?.bottom ?? Number.POSITIVE_INFINITY,
      };
    });
    assert.ok(
      desktopCodeModal.top >= 0 &&
        desktopCodeModal.bottom <= desktopCodeModal.viewportHeight &&
        desktopCodeModal.footerBottom <= desktopCodeModal.bottom &&
        desktopCodeModal.scrollHeight <= desktopCodeModal.clientHeight + 1,
      JSON.stringify(desktopCodeModal),
    );
    await page.screenshot({ path: path.join(screenshots, "code-project-preview.png") });
    await projectDialog.getByRole("button", { name: "手机 390px" }).click();
    await page.locator(".code-preview-surface.mobile iframe").waitFor({ state: "visible" });
    await page.screenshot({ path: path.join(screenshots, "code-project-preview-mobile.png") });
    const mobilePreviewLayout = await previewFrame.evaluate((iframe) => {
      const surface = iframe.parentElement;
      const computed = getComputedStyle(iframe);
      return {
        width: Math.round(iframe.getBoundingClientRect().width),
        computedWidth: computed.width,
        maxWidth: computed.maxWidth,
        flex: computed.flex,
        surfaceWidth: surface ? Math.round(surface.getBoundingClientRect().width) : null,
        surfaceClass: surface?.className ?? null,
      };
    });
    const mobilePreviewWidth = mobilePreviewLayout.width;
    assert.ok(
      mobilePreviewWidth >= 300 && mobilePreviewWidth <= 390,
      `mobile preview should be constrained to 390px or less, got ${JSON.stringify(mobilePreviewLayout)}`,
    );
    check(true, `Constrain the mobile code preview to ${mobilePreviewWidth}px (390px maximum)`);
    assert.equal(
      await preview.locator("h1").evaluate((heading) => getComputedStyle(heading).color),
      "rgb(18, 52, 86)",
    );
    await projectDialog.getByRole("button", { name: "桌面" }).click();
    await page.setViewportSize({ width: 320, height: 720 });
    await page.waitForFunction(() => window.innerWidth === 320 && window.innerHeight === 720);
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    const compactCodeModal = await projectDialog.evaluate((modal) => {
      const bounds = modal.getBoundingClientRect();
      const footer = modal.querySelector("footer");
      const footerBounds = footer?.getBoundingClientRect();
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        bounds: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom },
        styles: {
          height: getComputedStyle(modal).height,
          maxHeight: getComputedStyle(modal).maxHeight,
          minHeight: getComputedStyle(modal).minHeight,
          layerHeight: modal.parentElement?.getBoundingClientRect().height,
          layerDisplay: modal.parentElement ? getComputedStyle(modal.parentElement).display : null,
          viewportHeight: window.visualViewport?.height,
        },
        footerBottom: footerBounds?.bottom ?? Number.POSITIVE_INFINITY,
        scrollHeight: modal.scrollHeight,
        clientHeight: modal.clientHeight,
      };
    });
    assert.ok(
      compactCodeModal.bounds.left >= 0 &&
        compactCodeModal.bounds.right <= compactCodeModal.viewport.width &&
        compactCodeModal.bounds.top >= 0 &&
        compactCodeModal.bounds.bottom <= compactCodeModal.viewport.height &&
        compactCodeModal.footerBottom <= compactCodeModal.bounds.bottom &&
        compactCodeModal.scrollHeight <= compactCodeModal.clientHeight + 1,
      JSON.stringify(compactCodeModal),
    );
    await page.screenshot({ path: path.join(screenshots, "code-project-modal-320.png") });
    check(true, "Keep code-preview actions visible in the desktop and 320px phone artifact dialog");
    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForFunction(() => window.innerWidth === 320 && window.innerHeight === 568);
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
    const shortPhoneCodeModal = await projectDialog.evaluate((modal) => {
      const bounds = modal.getBoundingClientRect();
      const footerBounds = modal.querySelector("footer")?.getBoundingClientRect();
      const previewSurface = modal.querySelector(".code-preview-surface");
      const previewFrame = previewSurface?.querySelector("iframe");
      const previewSurfaceBounds = previewSurface?.getBoundingClientRect();
      const previewFrameBounds = previewFrame?.getBoundingClientRect();
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        bounds: { top: bounds.top, bottom: bounds.bottom },
        footerBottom: footerBounds?.bottom ?? Number.POSITIVE_INFINITY,
        previewSurfaceHeight: previewSurfaceBounds?.height ?? 0,
        previewFrameHeight: previewFrameBounds?.height ?? 0,
        scrollHeight: modal.scrollHeight,
        clientHeight: modal.clientHeight,
      };
    });
    assert.ok(
      shortPhoneCodeModal.bounds.top >= 0 &&
        shortPhoneCodeModal.bounds.bottom <= shortPhoneCodeModal.viewport.height &&
        shortPhoneCodeModal.footerBottom <= shortPhoneCodeModal.bounds.bottom &&
        shortPhoneCodeModal.previewSurfaceHeight >= 180 &&
        shortPhoneCodeModal.previewFrameHeight >= 120 &&
        shortPhoneCodeModal.scrollHeight <= shortPhoneCodeModal.clientHeight + 1,
      JSON.stringify(shortPhoneCodeModal),
    );
    await page.screenshot({ path: path.join(screenshots, "code-project-modal-short-phone.png") });
    check(true, "Keep code-preview actions visible on a 320×568 short phone viewport");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForFunction(() => window.innerWidth === 1440);
    await projectDialog.getByRole("button", { name: "源文件" }).click();
    await projectDialog.getByLabel("项目源文件").getByText("index.html", { exact: true }).waitFor();
    await projectDialog.getByRole("button", { name: "网页预览" }).click();
    check(true, "Preview static project HTML with local CSS inside a network-isolated sandbox");
    const projectDownloadPromise = page.waitForEvent("download", { timeout: 15_000 });
    await projectDialog.getByRole("button", { name: "下载 ZIP 项目" }).click();
    const projectDownload = await projectDownloadPromise;
    assert.match(projectDownload.suggestedFilename(), /\.zip$/);
    const projectArchive = await JSZip.loadAsync(fs.readFileSync(await projectDownload.path()), {
      checkCRC32: true,
    });
    assert.equal(
      await projectArchive.file("README.md").async("string"),
      "# UI Smoke Starter\n\nRun with Node.js.",
    );
    assert.equal(
      await projectArchive.file("docs/演示 说明.md").async("string"),
      "打开 index.html 查看项目预览。",
    );
    assert.equal(
      await projectArchive.file("docs/café.md").async("string"),
      "Unicode normalization test.",
    );
    assert.match(await projectArchive.file("index.html").async("string"), /Local preview ready/);
    assert.match(await projectArchive.file("src/app.tsx").async("string"), /Ready/);
    await projectDialog.getByRole("button", { name: "关闭产物" }).click();
    await projectDialog.waitFor({ state: "hidden" });
    check(true, "Download a valid code project ZIP containing its README and source files");

    const spreadsheetArchive = await downloadFixture(
      "UI Smoke Budget Workbook",
      "下载 Excel (.xlsx)",
      "xlsx",
    );
    assert.ok(spreadsheetArchive.file("xl/workbook.xml"));
    const worksheetXml = await spreadsheetArchive.file("xl/worksheets/sheet1.xml").async("string");
    const workbookStyles = await spreadsheetArchive.file("xl/styles.xml").async("string");
    const workbookRels = await spreadsheetArchive
      .file("xl/_rels/workbook.xml.rels")
      .async("string");
    assert.match(worksheetXml, /费用 &amp; 物料/);
    assert.match(worksheetXml, /<v>1200<\/v>/);
    assert.match(worksheetXml, /<cols><col[^>]+customWidth="1"/);
    assert.match(worksheetXml, /<pane ySplit="1" topLeftCell="A2"[^>]*state="frozen"\/>/);
    assert.match(worksheetXml, /<autoFilter ref="A1:B3"\/>/);
    assert.match(worksheetXml, /<c r="A1" s="1"/);
    assert.match(workbookStyles, /FF6C55A6/);
    assert.match(workbookStyles, /FFFFFFFF/);
    assert.match(workbookRels, /relationships\/styles/);
    check(
      true,
      "Download an Excel workbook with styled headers, filters, frozen panes, and fitted columns",
    );

    const presentationArchive = await downloadFixture(
      "UI Smoke Presentation",
      "下载 PowerPoint (.pptx)",
      "pptx",
    );
    assert.ok(presentationArchive.file("ppt/presentation.xml"));
    const slideFiles = Object.keys(presentationArchive.files).filter((name) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(name),
    );
    assert.equal(slideFiles.length, 2);
    const slideXml = await presentationArchive.file("ppt/slides/slide1.xml").async("string");
    assert.match(slideXml, /目标/);
    check(true, "Download a valid PowerPoint containing the requested slides");

    await page.locator(".chat-artifacts button").filter({ hasText: "UI Smoke 中文 PDF" }).click();
    const pdfDialog = page.getByRole("dialog");
    await pdfDialog.waitFor({ state: "visible" });
    const pdfDownloadPromise = page.waitForEvent("download", { timeout: 15_000 });
    await pdfDialog.getByRole("button", { name: "下载 PDF (.pdf)" }).click();
    const pdfDownload = await pdfDownloadPromise;
    assert.match(pdfDownload.suggestedFilename(), /\.pdf$/);
    const pdfBytes = fs.readFileSync(await pdfDownload.path());
    assert.equal(pdfBytes.subarray(0, 5).toString("ascii"), "%PDF-");
    const pdfText = await readChatDocument(
      new File([pdfBytes], pdfDownload.suggestedFilename(), { type: "application/pdf" }),
    );
    const normalizedPdfText = pdfText.replace(/\s+/g, "");
    assert.match(normalizedPdfText, /PDF活动方案/);
    assert.match(normalizedPdfText, /确认执行人员/);
    await pdfDialog.getByRole("status").getByText("PDF 文档已开始下载。").waitFor();
    await pdfDialog.getByRole("button", { name: "关闭产物" }).click();
    await pdfDialog.waitFor({ state: "hidden" });
    check(true, "Download and read back a Chinese PDF from the artifact panel");

    await page
      .locator(".chat-artifacts button")
      .filter({ hasText: /方案|策划|计划/ })
      .first()
      .click();
    await artifactDialog.waitFor({ state: "visible" });
  }
  await artifactDialog.getByRole("button", { name: "编辑方案" }).click();
  assert.equal(await artifactDialog.getByRole("status").count(), 0);
  const editor = artifactDialog.getByRole("textbox", { name: "编辑方案内容" });
  await editor.fill(`${await editor.inputValue()}\nUI smoke edit`);
  assert.equal(await artifactDialog.getByRole("status").count(), 0);
  await artifactDialog.getByRole("button", { name: "关闭产物" }).click();

  const discardDialog = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
  await discardDialog.waitFor({ state: "visible" });
  const zIndexes = await page.evaluate(() => ({
    confirmation: getComputedStyle(document.querySelector(".confirm-backdrop")).zIndex,
    artifact: getComputedStyle(document.querySelector(".modal-layer")).zIndex,
  }));
  assert.ok(Number(zIndexes.confirmation) > Number(zIndexes.artifact));
  await page.screenshot({ path: path.join(screenshots, "discard-confirmation.png") });
  await page.keyboard.press("Escape");
  await discardDialog.waitFor({ state: "hidden" });
  await artifactDialog.getByRole("button", { name: "关闭产物" }).click();
  await closeConfirmation(
    page,
    "Discarding unsaved edits shows a confirmation above the artifact editor",
    "放弃修改并关闭",
  );
  await artifactDialog.waitFor({ state: "hidden" });
  check(
    true,
    "Confirm dialog traps focus, closes with Escape, and stacks above the artifact modal",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  const workspaceMobileWidth = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  assert.equal(workspaceMobileWidth, true, "the mobile execution workspace must not overflow");
  await assertVisible(
    page.getByRole("button", { name: "导出完整工作区" }),
    "the workspace export action must remain visible on mobile",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  check(true, "Workspace export controls remain usable on a narrow mobile viewport");

  await page.getByRole("button", { name: "展开导航栏" }).click();
  await page.locator(".app-shell:not(.nav-collapsed)").waitFor();
  const knowledgeRejectionsBeforeSwitch = await page.evaluate(
    () => window.__goalflowUnhandledRejections?.length || 0,
  );
  let releaseKnowledgeRead;
  let markKnowledgeReadStarted;
  let finishKnowledgeRead;
  let heldKnowledgeRead = false;
  const knowledgeReadStarted = new Promise((resolve) => {
    markKnowledgeReadStarted = resolve;
  });
  const knowledgeReadFinished = new Promise((resolve) => {
    finishKnowledgeRead = resolve;
  });
  await page.route("**/api/knowledge", async (route) => {
    if (route.request().method() === "GET" && !heldKnowledgeRead) {
      heldKnowledgeRead = true;
      markKnowledgeReadStarted();
      await new Promise((resolve) => {
        releaseKnowledgeRead = resolve;
      });
      try {
        await route.continue();
      } catch {
        // A browser that already cancelled the request should not fail the smoke check.
      }
      finishKnowledgeRead();
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "我的知识库" }).click();
  await knowledgeReadStarted;
  await page.getByRole("button", { name: "探索入口" }).click();
  await page.getByRole("heading", { name: /接下来/ }).waitFor();
  releaseKnowledgeRead?.();
  await knowledgeReadFinished;
  await page.unroute("**/api/knowledge");
  await page.waitForTimeout(100);
  const knowledgeReadRejections = await page.evaluate(
    (startIndex) => (window.__goalflowUnhandledRejections || []).slice(startIndex),
    knowledgeRejectionsBeforeSwitch,
  );
  assert.deepEqual(
    knowledgeReadRejections.filter((rejection) => rejection.name === "AbortError"),
    [],
    "switching away from a pending knowledge read must not leak an AbortError",
  );
  assert.doesNotMatch(
    (await page.locator("nextjs-portal").allTextContents()).join(" "),
    /Runtime AbortError|Unhandled Runtime Error|signal is aborted without reason/i,
  );
  check(true, "Switching away from a pending knowledge read does not trigger an AbortError");
  await page.getByRole("button", { name: "我的知识库" }).click();
  await page.getByRole("heading", { name: "让 Agent 了解你的上下文。" }).waitFor();
  await assertNamedButtons(page, "knowledge library");
  await assertNamedFields(page, "knowledge library");
  await assertAccessible(page, "knowledge library");
  await page.getByRole("heading", { name: "知识库还是空的" }).waitFor();
  const rejectedKnowledgeTitle = `UI Smoke Rollback ${suffix.slice(0, 8)}`;
  let rejectKnowledgeOnce = true;
  await page.route("**/api/knowledge", async (route) => {
    if (route.request().method() === "POST" && rejectKnowledgeOnce) {
      rejectKnowledgeOnce = false;
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "知识库回归模拟保存失败" }),
      });
      return;
    }
    await route.continue();
  });
  await page.getByLabel("资料标题").fill(rejectedKnowledgeTitle);
  await page
    .getByLabel("资料内容")
    .fill("用于浏览器回归检查的临时知识资料，服务器会拒绝本次保存并触发乐观更新回滚。");
  await page.getByRole("button", { name: "加入知识库" }).click();
  const rejectedKnowledgeCard = page
    .locator(".knowledge-list article")
    .filter({ hasText: rejectedKnowledgeTitle });
  await rejectedKnowledgeCard.waitFor({ state: "visible" });
  await rejectedKnowledgeCard.getByText("正在保存").waitFor();
  await page.getByRole("alert").filter({ hasText: "知识库回归模拟保存失败" }).waitFor();
  await rejectedKnowledgeCard.waitFor({ state: "detached" });
  await page.unroute("**/api/knowledge");
  check(true, "Roll back an optimistic knowledge document when the save request fails");

  const knowledgeImportInput = page.locator('.knowledge-import input[type="file"]');
  await knowledgeImportInput.setInputFiles({
    name: "损坏资料.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("not an Office archive", "utf8"),
  });
  await page
    .getByRole("alert")
    .filter({ hasText: "Office 文档无法打开，请确认文件完整且未损坏。" })
    .waitFor();
  await knowledgeImportInput.setInputFiles({
    name: "知识库说明.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: attachmentDocxBuffer,
  });
  await page.waitForFunction(() =>
    document
      .querySelector(".knowledge-compose textarea")
      ?.value.includes("Browser DOCX extraction verified"),
  );
  assert.equal(await page.getByLabel("资料标题").inputValue(), "知识库说明");
  await knowledgeImportInput.setInputFiles({
    name: "知识库参考.pdf",
    mimeType: "application/pdf",
    buffer: makePdfAttachmentFixture(),
  });
  await page.waitForFunction(() =>
    document
      .querySelector(".knowledge-compose textarea")
      ?.value.includes("Browser PDF extraction verified"),
  );
  assert.equal(await page.getByLabel("资料标题").inputValue(), "知识库参考");
  await knowledgeImportInput.setInputFiles({
    name: "知识库预算.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: attachmentXlsxBuffer,
  });
  await page.waitForFunction(() =>
    document
      .querySelector(".knowledge-compose textarea")
      ?.value.includes("Browser spreadsheet context"),
  );
  assert.equal(await page.getByLabel("资料标题").inputValue(), "知识库预算");
  await knowledgeImportInput.setInputFiles({
    name: "知识库汇报.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: attachmentPptxBuffer,
  });
  await page.waitForFunction(() =>
    document
      .querySelector(".knowledge-compose textarea")
      ?.value.includes("Browser presentation context"),
  );
  assert.equal(await page.getByLabel("资料标题").inputValue(), "知识库汇报");
  check(
    true,
    "Extract browser DOCX, XLSX, PPTX, and PDF files into the private knowledge library editor",
  );

  const knowledgeTitle = `UI Smoke Reference ${suffix.slice(0, 8)}`;
  const knowledgeContent =
    "校园活动执行参考：先确认场地与预算，再安排招募、宣传、现场分工和活动复盘。";
  await page.getByLabel("资料标题").fill(knowledgeTitle);
  await page.getByLabel("资料内容").fill(knowledgeContent);
  await page.getByRole("button", { name: "加入知识库" }).click();
  const knowledgeCard = page.locator(".knowledge-list article").filter({ hasText: knowledgeTitle });
  await knowledgeCard.waitFor({ state: "visible" });
  assert.equal(await page.locator(".knowledge-list article").count(), 1);
  const knowledgeSearch = page.getByRole("textbox", { name: "搜索知识资料" });
  await knowledgeSearch.fill("现场分工");
  assert.equal(await page.locator(".knowledge-list article").count(), 1);
  await knowledgeSearch.fill("不存在的资料关键字");
  await page.getByRole("heading", { name: "没有找到匹配资料" }).waitFor();
  await knowledgeSearch.fill("");
  await knowledgeCard.locator("button.knowledge-open").click();
  const knowledgeDialog = page.locator('.knowledge-modal [role="dialog"]');
  await page.getByRole("dialog", { name: knowledgeTitle }).waitFor({ state: "visible" });
  await knowledgeDialog.waitFor({ state: "visible" });
  assert.equal(
    await knowledgeDialog.locator("#knowledge-dialog-content").innerText(),
    knowledgeContent,
  );
  const editedKnowledgeTitle = `${knowledgeTitle}（已修订）`;
  const editedKnowledgeContent =
    "校园活动执行参考：先确认场地与预算，再安排招募、宣传、现场分工、无障碍支持和活动复盘。";
  await knowledgeDialog.getByRole("button", { name: "编辑资料" }).click();
  await assertAccessible(page, "knowledge document editor");
  await page.getByRole("textbox", { name: "编辑资料标题" }).fill(editedKnowledgeTitle);
  await page.getByRole("textbox", { name: "编辑资料内容" }).fill(editedKnowledgeContent);
  await knowledgeDialog.getByRole("button", { name: "保存修改" }).click();
  await knowledgeDialog.getByRole("heading", { name: editedKnowledgeTitle }).waitFor();
  assert.equal(
    await knowledgeDialog.locator("#knowledge-dialog-content").innerText(),
    editedKnowledgeContent,
  );
  let rejectKnowledgeUpdateOnce = true;
  await page.route("**/api/knowledge/*", async (route) => {
    if (route.request().method() === "PUT" && rejectKnowledgeUpdateOnce) {
      rejectKnowledgeUpdateOnce = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "知识库回归模拟修改失败" }),
      });
      return;
    }
    await route.continue();
  });
  await knowledgeDialog.getByRole("button", { name: "编辑资料" }).click();
  await page.getByRole("textbox", { name: "编辑资料标题" }).fill("这次修改不会保存");
  await page
    .getByRole("textbox", { name: "编辑资料内容" })
    .fill("模拟网络故障时，编辑内容应保留在输入框中，方便修复连接后重新保存。");
  await knowledgeDialog.getByRole("button", { name: "保存修改" }).click();
  await page.getByRole("alert").filter({ hasText: "知识库回归模拟修改失败" }).waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "编辑资料标题" }).inputValue(),
    "这次修改不会保存",
  );
  assert.equal(await knowledgeCard.getByText(editedKnowledgeTitle).count(), 1);
  await page.unroute("**/api/knowledge/*");
  await knowledgeDialog.getByRole("button", { name: "取消" }).click();
  await knowledgeDialog.getByRole("button", { name: "关闭资料预览" }).click();
  check(true, "Add, search, and read a knowledge document in the browser");
  check(true, "Edit a knowledge document and retain draft changes after a save error");

  await page.setViewportSize({ width: 320, height: 720 });
  await page.waitForFunction(() => window.innerWidth === 320);
  const knowledgeMobileLayout = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".knowledge-compose, .knowledge-library")];
    const fields = [
      ...document.querySelectorAll(
        ".knowledge-compose input:not([type=file]), .knowledge-compose textarea",
      ),
    ];
    return {
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      cardsFit: cards.every((card) => card.getBoundingClientRect().right <= window.innerWidth),
      fieldsFit: fields.every((field) => field.getBoundingClientRect().right <= window.innerWidth),
    };
  });
  assert.equal(
    knowledgeMobileLayout.document <= 320 &&
      knowledgeMobileLayout.cardsFit &&
      knowledgeMobileLayout.fieldsFit,
    true,
    `knowledge import and library must fit a 320px viewport: ${JSON.stringify(knowledgeMobileLayout)}`,
  );
  await page.screenshot({ path: path.join(screenshots, "knowledge-mobile.png"), fullPage: true });
  await knowledgeCard.locator("button.knowledge-open").click();
  const mobileKnowledgeDialog = page.locator('.knowledge-modal [role="dialog"]');
  await mobileKnowledgeDialog.waitFor({ state: "visible" });
  await mobileKnowledgeDialog.getByRole("button", { name: "编辑资料" }).click();
  await assertAccessible(page, "mobile knowledge document editor");
  const knowledgeEditMobileLayout = await page.evaluate(() => {
    const dialog = document.querySelector('.knowledge-modal [role="dialog"]');
    const fields = [
      ...document.querySelectorAll(".knowledge-edit-form input, .knowledge-edit-form textarea"),
    ];
    const actions = document.querySelector(".knowledge-edit-actions");
    return {
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      dialogRight: dialog?.getBoundingClientRect().right ?? Infinity,
      fieldsFit: fields.every((field) => field.getBoundingClientRect().right <= window.innerWidth),
      actionsFit: (actions?.getBoundingClientRect().right ?? Infinity) <= window.innerWidth,
    };
  });
  assert.equal(
    knowledgeEditMobileLayout.document <= 320 &&
      knowledgeEditMobileLayout.dialogRight <= 320 &&
      knowledgeEditMobileLayout.fieldsFit &&
      knowledgeEditMobileLayout.actionsFit,
    true,
    `knowledge editing must fit a 320px viewport: ${JSON.stringify(knowledgeEditMobileLayout)}`,
  );
  await page.screenshot({
    path: path.join(screenshots, "knowledge-edit-mobile.png"),
    fullPage: true,
  });
  await mobileKnowledgeDialog.getByRole("button", { name: "取消" }).click();
  await mobileKnowledgeDialog.getByRole("button", { name: "关闭资料预览" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(() => window.innerWidth === 1440);
  check(true, "Keep knowledge import and the private library usable on a 320px phone");
  check(true, "Keep the knowledge document editor usable on a 320px phone");

  await page.getByRole("button", { name: "账户设置" }).click();
  await page.getByRole("heading", { name: "你的空间，由你掌控。" }).waitFor();
  const [accountBackupDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "下载账户备份" }).click(),
  ]);
  assert.match(accountBackupDownload.suggestedFilename(), /^vhfxnex-backup-.*\.json$/);
  const accountBackup = JSON.parse(fs.readFileSync(await accountBackupDownload.path(), "utf8"));
  assert.equal(accountBackup.user.email, adminEmail);
  assert.equal(accountBackup.workspaces.length, 1);
  assert.equal(accountBackup.knowledge.length, 1);
  assert.equal(accountBackup.knowledge[0].title, editedKnowledgeTitle);
  assert.equal("password_hash" in accountBackup.user, false);
  assert.equal("recovery_code_hash" in accountBackup.user, false);
  check(
    true,
    "Download a private account backup containing the executed workspace without secrets",
  );

  await page.getByRole("button", { name: /我的目标/ }).click();
  const deleteGoal = page.locator('button[aria-label^="删除目标："]').first();
  await deleteGoal.click();
  await closeConfirmation(
    page,
    "Deleting a goal uses the in-app confirmation",
    "删除目标",
    "goal-confirmation.png",
  );
  await deleteGoal.waitFor({ state: "detached" });
  await page.getByRole("heading", { name: /接下来/ }).waitFor();
  check(true, "Delete the test workspace through the browser and return to the empty state");

  await page.getByRole("button", { name: "账户设置" }).click();
  await page.getByRole("heading", { name: "你的空间，由你掌控。" }).waitFor();
  await page.locator('input[aria-label="选择账户备份文件"]').setInputFiles({
    name: "vhfxnex-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(accountBackup)),
  });
  const importNotice = `已导入 ${accountBackup.workspaces.length} 个工作空间和 ${accountBackup.knowledge.length} 篇知识资料`;
  await page.getByRole("status").filter({ hasText: importNotice }).waitFor();
  await page.getByRole("button", { name: /我的目标/ }).click();
  await page.getByRole("heading", { name: accountBackup.workspaces[0].plan.title }).waitFor();
  assert.equal(await page.locator('button[aria-label^="删除目标："]').count(), 1);
  check(true, "Restore a downloaded account backup in the browser and return to its workspace");
  await page.getByRole("button", { name: "我的知识库" }).click();
  await page.getByRole("heading", { name: "让 Agent 了解你的上下文。" }).waitFor();
  const restoredKnowledgeCard = page
    .locator(".knowledge-list article")
    .filter({ hasText: knowledgeTitle });
  await restoredKnowledgeCard.first().waitFor({ state: "visible" });
  assert.equal(
    await restoredKnowledgeCard.count(),
    2,
    "account restore should append the backup copy",
  );
  const restoredKnowledgeToDelete = restoredKnowledgeCard.first();
  await restoredKnowledgeToDelete
    .getByRole("button", { name: `删除${knowledgeTitle}` })
    .click({ force: true });
  await closeConfirmation(
    page,
    "Deleting a knowledge document explains how it affects future Agent plans",
    "删除资料",
  );
  await page.waitForFunction(
    (title) =>
      [...document.querySelectorAll(".knowledge-list article")].filter((article) =>
        article.textContent?.includes(title),
      ).length === 1,
    knowledgeTitle,
  );
  assert.equal(await restoredKnowledgeCard.count(), 1);
  check(true, "Restore and delete a private knowledge document through the browser");
  await page.getByRole("button", { name: /我的目标/ }).click();
  await page.getByRole("button", { name: "新建目标" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () =>
      window.matchMedia("(max-width: 700px)").matches &&
      Number.parseFloat(getComputedStyle(document.querySelector(".hero h1")).fontSize) <= 55,
  );
  const mobileWidth = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  assert.equal(mobileWidth, true, "the signed-in mobile workspace must not overflow horizontally");
  const mobileHeroFits = await page.locator(".hero h1").evaluate((heading) => {
    const style = getComputedStyle(heading);
    return {
      fits: heading.scrollWidth <= heading.clientWidth,
      fontSize: style.fontSize,
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.clientWidth,
      visualViewportWidth: window.visualViewport?.width,
      mobileMediaMatches: window.matchMedia("(max-width: 700px)").matches,
      headingWidth: heading.clientWidth,
      contentWidth: heading.scrollWidth,
    };
  });
  assert.equal(
    mobileHeroFits.fits,
    true,
    `mobile headline must not be clipped: ${JSON.stringify(mobileHeroFits)}`,
  );
  await assertAccessible(page, "signed-in mobile home");
  await page.screenshot({ path: path.join(screenshots, "mobile-home.png"), fullPage: true });
  const menuButton = page.getByRole("button", { name: "打开菜单" });
  assert.equal(
    await page.locator(".home-examples").evaluate((examples) => getComputedStyle(examples).display),
    "none",
    "small screens should not move the example cards below the home composer",
  );
  await menuButton.click();
  const mobileMenu = page.getByRole("dialog", { name: "导航菜单" });
  await mobileMenu.waitFor({ state: "visible" });
  await page.screenshot({ path: path.join(screenshots, "mobile-example-sidebar.png") });
  const exampleChoice = mobileMenu.getByRole("button", { name: /策划一场社团招新/ });
  await exampleChoice.click();
  await mobileMenu.waitFor({ state: "hidden" });
  assert.match(await page.getByLabel("描述你想完成的目标").inputValue(), /社团招新/);
  await page.getByLabel("描述你想完成的目标").fill("");
  check(true, "Keep mobile home examples in the side navigation and prefill the selected goal");
  await menuButton.click();
  await mobileMenu.waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await mobileMenu.waitFor({ state: "hidden" });
  assert.equal(
    await menuButton.evaluate((element) => element === document.activeElement),
    true,
    "closing the mobile navigation must restore focus to its trigger",
  );
  await menuButton.click();
  await page.getByRole("button", { name: "账户设置" }).click();
  await page.getByRole("heading", { name: "你的空间，由你掌控。" }).waitFor();
  const mobileAccountWidth = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  assert.equal(
    mobileAccountWidth,
    true,
    "the mobile account settings screen must fit the viewport",
  );
  await assertAccessible(page, "mobile account settings");
  await page.screenshot({ path: path.join(screenshots, "mobile-account.png"), fullPage: true });
  await menuButton.click();
  await page.getByRole("button", { name: "管理控制台" }).click();
  await page.getByRole("heading", { name: "管理控制台" }).waitFor();
  const mobileAdminWidth = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  assert.equal(mobileAdminWidth, true, "the mobile admin screen must not overflow horizontally");
  await assertAccessible(page, "small-phone admin console");
  const adminTablesUseCards = await page.locator(".admin-table table").evaluateAll((tables) =>
    tables.every((table) => {
      const firstRow = table.querySelector("tbody tr");
      const firstCell = firstRow?.querySelector("td");
      return getComputedStyle(table).display === "block" &&
        getComputedStyle(firstRow).display === "block" &&
        Boolean(firstCell?.getAttribute("data-label")) &&
        firstCell
        ? getComputedStyle(firstCell, "::before").content !== "none"
        : false;
    }),
  );
  assert.equal(adminTablesUseCards, true, "mobile admin tables must become labelled data cards");
  await page.screenshot({ path: path.join(screenshots, "mobile-admin.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.waitForFunction(() => window.innerWidth === 320);
  const smallPhoneAdmin = await page.evaluate(() => {
    const heading = document.querySelector("h1");
    const tables = [...document.querySelectorAll(".admin-table table")];
    const cards = [...document.querySelectorAll(".admin-table tbody tr")];
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      headingFits: Boolean(heading && heading.scrollWidth <= heading.clientWidth),
      tablesUseCards:
        tables.length === 2 &&
        cards.length >= 2 &&
        tables.every((table) => getComputedStyle(table).display === "block"),
      fieldsHaveLabels: [...document.querySelectorAll(".admin-table tbody td")].every((cell) =>
        Boolean(cell.getAttribute("data-label")),
      ),
    };
  });
  assert.equal(
    smallPhoneAdmin.documentWidth <= smallPhoneAdmin.viewportWidth,
    true,
    `the admin console must fit a 320px screen: ${JSON.stringify(smallPhoneAdmin)}`,
  );
  assert.equal(smallPhoneAdmin.headingFits, true, "the small-phone admin heading must not clip");
  assert.equal(
    smallPhoneAdmin.tablesUseCards,
    true,
    "admin data must become cards on a small phone",
  );
  assert.equal(smallPhoneAdmin.fieldsHaveLabels, true, "small-phone admin cards need field labels");
  await page.screenshot({ path: path.join(screenshots, "small-phone-admin.png"), fullPage: true });
  check(
    true,
    "Mobile account/workspace fit; admin tables use labelled cards down to 320px and navigation restores focus",
  );
  let expiredSaveTriggered = false;
  await page.route("**/api/workspaces", async (route) => {
    if (route.request().method() === "POST" && !expiredSaveTriggered) {
      expiredSaveTriggered = true;
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "请先登录" }),
      });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "打开菜单" }).click();
  const workspaceMenu = page.getByRole("dialog", { name: "导航菜单" });
  await workspaceMenu.getByRole("button", { name: /我的目标/ }).click();
  await page.getByRole("heading", { name: "每个目标，都在向前。" }).waitFor();
  await page.locator(".history-card-open").first().click();
  const firstWorkspaceTask = page.locator(".task-list button").first();
  await firstWorkspaceTask.waitFor({ state: "visible" });
  const firstTaskWasDone = await firstWorkspaceTask.evaluate((button) =>
    button.classList.contains("done"),
  );
  await firstWorkspaceTask.click();
  await page
    .locator(".form-error")
    .getByText(/使用原账户重新登录后，会恢复并重试/)
    .waitFor();
  await page.getByPlaceholder("you@example.com").waitFor();
  assert.equal(await page.getByRole("heading", { name: "欢迎回来" }).count(), 1);
  await page.getByPlaceholder("you@example.com").fill(adminEmail);
  await page.getByPlaceholder("至少 8 位字符").fill(nextPassword);
  const recoveredWorkspaceWrite = page.waitForResponse(
    (response) =>
      response.url().includes("/api/workspaces") &&
      response.request().method() === "POST" &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "进入空间" }).click();
  await recoveredWorkspaceWrite;
  await page.locator(".workspace-head h1").waitFor({ state: "visible" });
  const recoveredTaskIsDone = await page
    .locator(".task-list button")
    .first()
    .evaluate((button) => button.classList.contains("done"));
  assert.equal(recoveredTaskIsDone, !firstTaskWasDone);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    "the recovered workspace must fit the small-phone viewport",
  );
  await page.unroute("**/api/workspaces");
  check(true, "Restore the exact unsaved workspace after the same account signs in again");

  await page.getByRole("button", { name: "打开菜单" }).click();
  const homeMenu = page.getByRole("dialog", { name: "导航菜单" });
  await homeMenu.getByRole("button", { name: "探索入口" }).click();
  const goalDraft = "会话过期后恢复目标草稿，保留参考图，让用户重新确认后再规划。";
  const goalInput = page.getByRole("textbox", { name: "描述你想完成的目标" });
  await goalInput.fill(goalDraft);
  const liveAiAvailable = await page.evaluate(async () => {
    const response = await fetch("/api/auth/me");
    return (await response.json()).aiConfigured === true;
  });
  let expectedDraftImage = "";
  let expectedDraftAttachment = false;
  if (liveAiAvailable) {
    if (await page.getByRole("button", { name: "演示模式已开启" }).isVisible())
      await page.getByRole("button", { name: "演示模式已开启" }).click();
    await page.locator(".plan-image-input").setInputFiles({
      name: "recovery-reference.png",
      mimeType: "image/png",
      buffer: redSwatchPng,
    });
    await page.locator(".image-chip").getByText("recovery-reference.png").waitFor();
    expectedDraftImage = `data:image/png;base64,${redSwatchPng.toString("base64")}`;
    await page.locator(".plan-document-input").setInputFiles({
      name: "恢复资料.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("恢复后保留本条活动约束资料。", "utf8"),
    });
    await page.locator(".plan-attachment-chip").getByText("恢复资料.md").waitFor();
    expectedDraftAttachment = true;
  }
  let planRequestCount = 0;
  let interruptedPlanBody;
  await page.route("**/api/plan", async (route) => {
    if (route.request().method() === "POST") {
      planRequestCount += 1;
      interruptedPlanBody = route.request().postDataJSON();
      if (planRequestCount === 1) {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: "请先登录" }),
        });
        return;
      }
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "开始探索" }).click();
  await page
    .locator(".form-error")
    .getByText(/会恢复刚才提交的目标描述、参考图和资料/)
    .waitFor();
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    "the restored-plan message must not overflow the small-phone login screen",
  );
  await page.getByPlaceholder("you@example.com").fill(adminEmail);
  await page.getByPlaceholder("至少 8 位字符").fill(nextPassword);
  await page.getByRole("button", { name: "进入空间" }).click();
  const restoredGoalInput = page.getByRole("textbox", { name: "描述你想完成的目标" });
  await restoredGoalInput.waitFor({ state: "visible" });
  assert.equal(await restoredGoalInput.inputValue(), goalDraft);
  assert.equal(interruptedPlanBody?.prompt, goalDraft);
  assert.equal(interruptedPlanBody?.image || "", expectedDraftImage);
  assert.equal(
    interruptedPlanBody?.attachments?.some(
      (attachment) =>
        attachment.name === "恢复资料.md" && attachment.content.includes("活动约束资料"),
    ) || false,
    expectedDraftAttachment,
  );
  assert.equal(planRequestCount, 1, "re-login must not automatically repeat a paid planning call");
  if (expectedDraftImage) {
    await page.locator(".image-chip").getByText("recovery-reference.png").waitFor();
  }
  if (expectedDraftAttachment) {
    await page.locator(".plan-attachment-chip").getByText("恢复资料.md").waitFor();
  }
  await page.unroute("**/api/plan");
  check(
    true,
    "Restore the submitted goal, reference image, and document after re-login without auto-spending model tokens",
  );

  await page.getByRole("button", { name: "打开菜单" }).click();
  const deletionHistoryMenu = page.getByRole("dialog", { name: "导航菜单" });
  await deletionHistoryMenu.getByRole("button", { name: /我的目标/ }).click();
  await page.getByRole("heading", { name: "每个目标，都在向前。" }).waitFor();
  await page.locator(".history-card-open").first().click();
  let failedDeleteSave = false;
  await page.route("**/api/workspaces", async (route) => {
    if (route.request().method() === "POST" && !failedDeleteSave) {
      failedDeleteSave = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "删除回归模拟保存失败" }),
      });
      return;
    }
    await route.continue();
  });
  await page.locator(".task-list button").first().click();
  await page.locator(".error-banner").getByText("删除回归模拟保存失败").waitFor();
  await page.getByRole("button", { name: "打开菜单" }).click();
  const deletePendingMenu = page.getByRole("dialog", { name: "导航菜单" });
  await deletePendingMenu.getByRole("button", { name: /我的目标/ }).click();
  await page.locator('button[aria-label^="删除目标："]').first().click();
  await closeConfirmation(
    page,
    "Deleting a workspace also cancels a failed pending save",
    "删除目标",
  );
  await page.getByRole("heading", { name: /接下来/ }).waitFor();
  assert.equal(await page.getByRole("button", { name: "重试保存工作空间" }).count(), 0);
  const workspacesAfterPendingDelete = await page.evaluate(async () => {
    const response = await fetch("/api/workspaces");
    return (await response.json()).workspaces;
  });
  assert.equal(workspacesAfterPendingDelete.length, 0);
  await page.unroute("**/api/workspaces");
  check(true, "Prevent a deleted workspace from returning through a stale save retry");

  const attachmentFlowWorkspaceId = crypto.randomUUID();
  const attachmentFlowPrompt = "验证文档附件正文是否进入 Agent 执行请求";
  const attachmentFlowPlan = {
    title: "附件请求链路回归检查",
    category: "项目推进",
    summary: "确认浏览器提取的文档正文能随本轮请求交给 Agent。",
    constraints: ["不调用真实模型"],
    routes: [
      {
        id: "attachment-flow-route",
        title: "检查附件传递",
        subtitle: "逐项核对提取后的正文",
        fit: 100,
        reason: "本轮目标是检查附件内容是否完整抵达执行接口。",
        accent: "violet",
      },
    ],
    tasks: [
      {
        id: "attachment-flow-task",
        title: "确认附件正文已发送",
        detail: "核对 Markdown 与环境示例文本。",
        phase: "验证",
        status: "pending",
      },
    ],
    question: "",
    sources: [],
  };
  const attachmentFlowWorkspace = {
    id: attachmentFlowWorkspaceId,
    prompt: attachmentFlowPrompt,
    plan: attachmentFlowPlan,
    selectedRouteId: "attachment-flow-route",
    result: null,
    conversation: [
      { id: crypto.randomUUID(), role: "user", content: attachmentFlowPrompt },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: attachmentFlowPlan.summary,
      },
    ],
    createdAt: new Date().toISOString(),
    mode: "live",
  };
  const attachmentWorkspaceSave = await page.evaluate(async (workspace) => {
    const response = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace }),
    });
    return { status: response.status, payload: await response.json() };
  }, attachmentFlowWorkspace);
  assert.equal(
    attachmentWorkspaceSave.status,
    200,
    attachmentWorkspaceSave.payload?.error || "attachment flow workspace must be saved",
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".home-primary").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "打开菜单" }).click();
  const attachmentFlowMenu = page.getByRole("dialog", { name: "导航菜单" });
  await attachmentFlowMenu.getByRole("button", { name: /我的目标/ }).click();
  const attachmentFlowCard = page
    .locator(".history-grid article")
    .filter({ hasText: attachmentFlowWorkspace.plan.title });
  await attachmentFlowCard.locator(".history-card-open").click();
  await page.locator("#workspace-chat-input").waitFor({ state: "visible" });
  const capturedAttachmentExecuteRequests = [];
  let markFirstAttachmentExecutionSeen;
  const firstAttachmentExecutionSeen = new Promise((resolve) => {
    markFirstAttachmentExecutionSeen = resolve;
  });
  await page.route("**/api/execute", async (route) => {
    capturedAttachmentExecuteRequests.push(route.request().postDataJSON());
    if (capturedAttachmentExecuteRequests.length === 1) {
      markFirstAttachmentExecutionSeen();
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
      body: `event: result\ndata: ${JSON.stringify({
        type: "result",
        data: {
          result: {
            summary: "回归执行已收到附件正文。",
            tasks: attachmentFlowWorkspace.plan.tasks,
            milestones: [],
            artifacts: [],
            events: [],
          },
          mode: "demo",
        },
      })}\n\n`,
    });
  });
  let capturedAttachmentChatRequest;
  await page.route("**/api/chat", async (route) => {
    capturedAttachmentChatRequest = route.request().postDataJSON();
    const instruction = "读取并核对附件正文，继续完成当前验证并生成结果。";
    const userMessageId = crypto.randomUUID();
    const userMessage = [
      capturedAttachmentChatRequest.question,
      `附件：${capturedAttachmentChatRequest.attachments.map(({ name }) => name).join("、")}`,
    ]
      .filter(Boolean)
      .join("\n");
    const acknowledgment = "我已理解附件要求，交给工作台读取并完成验证。";
    const savedConversation = await page.evaluate(
      async ({
        workspaceId,
        userMessageId,
        userMessage,
        acknowledgment,
        instruction,
        attachments,
      }) => {
        const currentResponse = await fetch(`/api/workspaces/${workspaceId}`);
        const current = await currentResponse.json();
        current.workspace.conversation = [
          ...(current.workspace.conversation || []),
          { id: userMessageId, role: "user", content: userMessage },
          { id: crypto.randomUUID(), role: "assistant", content: acknowledgment },
        ].slice(-40);
        const saveResponse = await fetch("/api/workspaces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspace: current.workspace }),
        });
        const saved = await saveResponse.json();
        if (!saveResponse.ok) return { status: saveResponse.status, payload: saved };
        const handoffResponse = await fetch("/api/handoffs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            userMessageId,
            userMessage,
            instruction,
            attachments,
          }),
        });
        return {
          status: saveResponse.status,
          payload: saved,
          handoffStatus: handoffResponse.status,
          handoff: await handoffResponse.json(),
        };
      },
      {
        workspaceId: attachmentFlowWorkspaceId,
        userMessageId,
        userMessage,
        acknowledgment,
        instruction,
        attachments: capturedAttachmentChatRequest.attachments,
      },
    );
    assert.equal(
      savedConversation.status,
      200,
      savedConversation.payload?.error || "the chat handoff message must be stored",
    );
    assert.equal(
      savedConversation.handoffStatus,
      200,
      savedConversation.handoff?.error || "the server handoff queue must accept this job",
    );
    const handoff = {
      handoffId: savedConversation.handoff.handoff.id,
      instruction,
      userMessageId,
      userMessage,
      acknowledgment,
      queued: false,
    };
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
      body: [
        { type: "text", text: acknowledgment },
        { type: "handoff", ...handoff },
        { type: "result", data: { kind: "handoff", ...handoff } },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(""),
    });
  });
  await page.locator('.workspace-chat-composer input[type="file"]').setInputFiles([
    {
      name: "附件正文.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# 附件内容\n这段 Markdown 必须进入执行请求。", "utf8"),
    },
    {
      name: ".env.example",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("API_KEY=sample-placeholder\n", "utf8"),
    },
    {
      name: "浏览器读取.pdf",
      mimeType: "application/pdf",
      buffer: makePdfAttachmentFixture(),
    },
    {
      name: "浏览器读取.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: attachmentXlsxBuffer,
    },
    {
      name: "浏览器读取.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      buffer: attachmentPptxBuffer,
    },
  ]);
  await page
    .waitForFunction(
      () =>
        document.querySelectorAll(".chat-attachment-chip").length === 5 ||
        Boolean(document.querySelector(".chat-error")),
      null,
      { timeout: 15_000 },
    )
    .catch(() => undefined);
  const parsedAttachmentCount = await page.locator(".chat-attachment-chip").count();
  assert.equal(
    parsedAttachmentCount,
    5,
    await page
      .locator(".chat-error")
      .innerText()
      .catch(() => `Expected 3 parsed attachments; found ${parsedAttachmentCount}`),
  );
  await page
    .locator("#workspace-chat-input")
    .fill("请根据附件正文继续完成当前验证，并确认正文已进入执行任务。");
  await page.getByRole("button", { name: "发送给 Agent", exact: true }).click();
  await firstAttachmentExecutionSeen;
  await page.waitForFunction(async () => {
    const response = await fetch("/api/handoffs");
    const payload = await response.json();
    return payload.handoffs?.length === 1;
  });
  // This browser smoke intentionally runs without the server-side worker. Simulate its
  // retry deadline expiring so a page reload can recover the durable handoff immediately.
  database
    .prepare("UPDATE workbench_handoffs SET next_attempt_at = NULL WHERE workspace_id = ?")
    .run(attachmentFlowWorkspaceId);
  assert.equal(
    capturedAttachmentChatRequest?.question,
    "请根据附件正文继续完成当前验证，并确认正文已进入执行任务。",
  );
  assert.equal(capturedAttachmentChatRequest?.attachments?.length, 5);
  const adminUserId = database.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail).id;
  const statusWorkspaceId = crypto.randomUUID();
  const statusWorkspace = {
    ...attachmentFlowWorkspace,
    id: statusWorkspaceId,
    prompt: "验证服务端运行状态恢复",
    plan: { ...attachmentFlowWorkspace.plan, title: "后台状态恢复验证" },
    mode: "demo",
    conversation: [],
  };
  const statusWorkspaceTime = new Date().toISOString();
  database
    .prepare(
      "INSERT INTO workspaces (id, user_id, title, category, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      statusWorkspaceId,
      adminUserId,
      statusWorkspace.plan.title,
      statusWorkspace.plan.category,
      JSON.stringify(statusWorkspace),
      statusWorkspaceTime,
      statusWorkspaceTime,
    );
  const recoveredExecutionToken = crypto.randomUUID();
  const recoveredExecutionTime = new Date().toISOString();
  database
    .prepare(
      "INSERT INTO workspace_execution_locks (workspace_id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run(statusWorkspaceId, adminUserId, recoveredExecutionToken, Date.now() + 60_000);
  database
    .prepare(
      `INSERT INTO workspace_execution_status
        (token, workspace_id, user_id, workspace_title, state, activity, completed_tool_calls,
         message, started_at, updated_at, finished_at)
       VALUES (?, ?, ?, ?, 'running', ?, 3, NULL, ?, ?, NULL)`,
    )
    .run(
      recoveredExecutionToken,
      statusWorkspaceId,
      adminUserId,
      statusWorkspace.plan.title,
      "正在检查附件并恢复工作台执行",
      recoveredExecutionTime,
      recoveredExecutionTime,
    );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload({ waitUntil: "networkidle" });
  const restoredExecutionChip = page.locator(".topbar-execution-chip.running");
  await restoredExecutionChip.waitFor({ timeout: 4_000 });
  assert.match(await restoredExecutionChip.getAttribute("title"), /后台状态恢复验证/);
  assert.match(await restoredExecutionChip.innerText(), /正在检查附件并恢复工作台执行/);
  assert.match(await restoredExecutionChip.innerText(), /已完成 3 次工具操作/);
  await page.getByRole("button", { name: /我的目标/ }).click();
  const statusWorkspaceCard = page
    .locator(".history-grid article")
    .filter({ hasText: statusWorkspace.plan.title });
  await statusWorkspaceCard.locator(".history-card-open").click();
  let progressQuestionRequest;
  await page.route("**/api/chat", async (route) => {
    progressQuestionRequest = route.request().postDataJSON();
    await route.continue();
  });
  await page.locator("#workspace-chat-input").fill("这个项目做到哪里了？");
  await page.getByRole("button", { name: /^发送(?:给 Agent)?$/ }).click();
  try {
    await page
      .locator(".workspace-chat-thread")
      .getByText(/已记录 3 次工具操作；这是活动记录，不代表项目完成百分比/)
      .waitFor({ state: "visible" });
  } catch (error) {
    console.error(
      "Active execution progress reply diagnostics:",
      JSON.stringify({
        request: progressQuestionRequest,
        thread: await page
          .locator(".workspace-chat-thread")
          .innerText()
          .catch(() => ""),
        alert: await page
          .locator(".error-banner:visible")
          .innerText()
          .catch(() => ""),
      }),
    );
    throw error;
  }
  await page.unroute("**/api/chat");
  check(
    true,
    "Let the dialog Agent answer a progress question while workbench execution is active",
  );
  await page.getByRole("button", { name: "停止任务" }).click();
  await page.waitForFunction(async (workspaceId) => {
    const response = await fetch("/api/executions");
    const payload = await response.json();
    return payload.executions?.some(
      (execution) => execution.workspaceId === workspaceId && execution.cancelRequested,
    );
  }, statusWorkspaceId);
  check(true, "Send an explicit server cancellation request from the workbench stop button");
  const expandNavigationForHistory = page.getByRole("button", { name: "展开导航栏" });
  if (await expandNavigationForHistory.count()) await expandNavigationForHistory.click();
  await page.getByRole("button", { name: /我的目标/ }).click();
  const attachmentFlowCardAfterReload = page
    .locator(".history-grid article")
    .filter({ hasText: attachmentFlowWorkspace.plan.title });
  await attachmentFlowCardAfterReload.locator(".history-card-open").click();
  await page.locator("#workspace-chat-input").waitFor({ state: "visible" });
  assert.match(
    await page.locator(".topbar-execution-chip.running").innerText(),
    /后台状态恢复验证/,
    "switching to a different workspace must keep the other workspace's active execution visible",
  );
  check(true, "Keep a running workspace visible while the user opens a different workspace");
  check(true, "Restore the current workspace execution and activity indicator after a page reload");
  await page.waitForFunction(
    async (workspaceId) => {
      const response = await fetch(`/api/workspaces/${workspaceId}`);
      if (!response.ok) return false;
      const payload = await response.json();
      return payload.workspace?.result?.summary === "回归执行已收到附件正文。";
    },
    attachmentFlowWorkspaceId,
    { timeout: 30_000 },
  );
  assert.equal(capturedAttachmentExecuteRequests.length, 2);
  assert.equal(capturedAttachmentExecuteRequests[1]?.demo, false);
  assert.ok(capturedAttachmentExecuteRequests[1]?.handoffJobId);
  assert.ok(capturedAttachmentExecuteRequests[1]?.handoffClaimToken);
  assert.equal(
    capturedAttachmentExecuteRequests[0]?.handoffJobId,
    capturedAttachmentExecuteRequests[1]?.handoffJobId,
    "the durable job identity must survive reload",
  );
  assert.notEqual(
    capturedAttachmentExecuteRequests[0]?.handoffClaimToken,
    capturedAttachmentExecuteRequests[1]?.handoffClaimToken,
    "a recovered job must receive a fresh execution claim",
  );
  const pendingHandoffsAfterExecution = await page.evaluate(async () => {
    const response = await fetch("/api/handoffs");
    const payload = await response.json();
    return payload.handoffs;
  });
  assert.equal(
    pendingHandoffsAfterExecution.length,
    0,
    "a handed-off job must be removed from the pending queue after successful delivery",
  );
  const expandNavigation = page.getByRole("button", { name: "展开导航栏" });
  if (await expandNavigation.count()) await expandNavigation.click();
  await page.getByRole("button", { name: /探索入口/ }).click();
  await page.locator(".home-primary").waitFor({ state: "visible" });
  assert.match(
    await page.locator(".topbar-execution-chip.running").innerText(),
    /后台状态恢复验证/,
    "leaving the active workspace must not hide its running status",
  );
  check(true, "Keep the execution indicator visible after leaving the active workspace");
  database
    .prepare("DELETE FROM workspace_execution_locks WHERE workspace_id = ? AND token = ?")
    .run(statusWorkspaceId, recoveredExecutionToken);
  database
    .prepare("DELETE FROM workspace_execution_status WHERE token = ?")
    .run(recoveredExecutionToken);
  database.prepare("DELETE FROM workspaces WHERE id = ?").run(statusWorkspaceId);
  assert.deepEqual(
    capturedAttachmentExecuteRequests[1]?.attachments?.map(({ name, kind, content }) => ({
      name,
      kind,
      content,
    })),
    [
      {
        name: "附件正文.md",
        kind: "text",
        content: "# 附件内容\n这段 Markdown 必须进入执行请求。",
      },
      {
        name: ".env.example",
        kind: "text",
        content: "API_KEY=sample-placeholder",
      },
      {
        name: "浏览器读取.pdf",
        kind: "text",
        content: "Browser PDF extraction verified",
      },
      {
        name: "浏览器读取.xlsx",
        kind: "text",
        content: "工作表 1\nA1=Browser spreadsheet context",
      },
      {
        name: "浏览器读取.pptx",
        kind: "text",
        content: "第 1 张幻灯片\nBrowser presentation context",
      },
    ],
    "the execution request must contain extracted text from Markdown, environment, PDF, XLSX, and PPTX files",
  );
  await page.unroute("**/api/execute");
  const attachmentWorkspaceDelete = await page.evaluate(async (id) => {
    const response = await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
    return { ok: response.ok, status: response.status };
  }, attachmentFlowWorkspaceId);
  assert.equal(attachmentWorkspaceDelete.ok, true);
  await page.locator(".home-primary").waitFor({ state: "visible" });
  check(
    true,
    "Transmit extracted Markdown, .env.example, PDF, XLSX, and PPTX bodies to the Agent request without real model calls",
  );

  await page.getByRole("button", { name: /我的目标/ }).click();
  await page.locator(".history-grid").waitFor({ state: "visible" });
  const speechTestWorkspace = page.locator(".history-grid article .history-card-open").first();
  assert.ok(
    (await speechTestWorkspace.count()) > 0,
    "a saved workspace should be available for voice input checks",
  );
  await speechTestWorkspace.click();
  const speechButton = page.getByRole("button", { name: "语音输入", exact: true });
  await speechButton.waitFor({ state: "visible" });
  await page.evaluate(() => {
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: undefined,
    });
  });
  await speechButton.click();
  await page.getByText("当前浏览器不支持语音识别，请使用文字输入。", { exact: true }).waitFor();
  assert.equal(await speechButton.getAttribute("aria-pressed"), "false");
  await page.evaluate(() => {
    class DeniedSpeechRecognition {
      onerror = null;
      onend = null;
      start() {
        window.setTimeout(() => this.onerror?.({ error: "not-allowed" }), 0);
      }
      stop() {
        this.onend?.();
      }
    }
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: DeniedSpeechRecognition,
    });
  });
  await speechButton.click();
  await page
    .getByText("麦克风权限未开启；请在浏览器地址栏允许麦克风后重试。", { exact: true })
    .waitFor();
  assert.equal(await speechButton.getAttribute("aria-pressed"), "false");
  await page.evaluate(() => {
    class WorkingSpeechRecognition {
      onresult = null;
      onend = null;
      start() {
        window.setTimeout(
          () =>
            this.onresult?.({
              resultIndex: 0,
              results: [{ isFinal: true, 0: { transcript: "语音输入回归通过" } }],
            }),
          0,
        );
      }
      stop() {
        this.onend?.();
      }
    }
    Object.defineProperty(window, "SpeechRecognition", {
      configurable: true,
      value: WorkingSpeechRecognition,
    });
  });
  await speechButton.click();
  const speechInput = page.locator("#workspace-chat-input");
  await page.waitForFunction(() =>
    document.querySelector("#workspace-chat-input")?.value.includes("语音输入回归通过"),
  );
  assert.equal(await page.locator(".chat-voice-button").getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "停止语音", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.chat-voice-button[aria-pressed="false"]') !== null,
  );
  assert.match(await speechInput.inputValue(), /语音输入回归通过/);
  check(true, "Handle speech recognition success, permission denial, and unsupported browsers");

  mobileAuthContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    extraHTTPHeaders: { "X-Forwarded-For": smokeClientAddress },
  });
  const mobileAuthPage = await mobileAuthContext.newPage();
  mobileAuthPage.setDefaultTimeout(8_000);
  await mobileAuthPage.goto(baseUrl.href, { waitUntil: "networkidle" });
  await mobileAuthPage.getByPlaceholder("例如：星云").waitFor({ state: "visible" });
  await assertNamedFields(mobileAuthPage, "mobile registration");
  await assertAccessible(mobileAuthPage, "mobile registration");
  const mobileAuthWidth = await mobileAuthPage.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  assert.equal(
    mobileAuthWidth,
    true,
    "the mobile registration screen must not overflow horizontally",
  );
  await mobileAuthPage.screenshot({
    path: path.join(screenshots, "mobile-register.png"),
    fullPage: true,
  });
  await assertSmallPhoneAuth(
    mobileAuthPage,
    "Small-phone registration",
    "small-phone-register.png",
  );
  await mobileAuthPage.setViewportSize({ width: 390, height: 844 });
  await mobileAuthPage.getByRole("button", { name: "登录账户" }).click();
  await mobileAuthPage.getByRole("heading", { name: "欢迎回来" }).waitFor();
  await assertNamedFields(mobileAuthPage, "mobile login");
  await assertAccessible(mobileAuthPage, "mobile login");
  const mobileLoginWidth = await mobileAuthPage.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  assert.equal(mobileLoginWidth, true, "the mobile login screen must not overflow horizontally");
  await assertSmallPhoneAuth(mobileAuthPage, "Small-phone login", "small-phone-login.png");
  await mobileAuthPage.setViewportSize({ width: 390, height: 844 });
  await mobileAuthPage.getByRole("button", { name: "忘记密码？使用账户恢复码找回" }).click();
  await mobileAuthPage.getByRole("heading", { name: "用恢复码找回账户" }).waitFor();
  await assertNamedFields(mobileAuthPage, "mobile account recovery");
  await assertAccessible(mobileAuthPage, "mobile account recovery");
  const recoveryScreenWidth = await mobileAuthPage.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  assert.equal(recoveryScreenWidth, true, "the mobile recovery screen must not overflow");
  await assertSmallPhoneAuth(
    mobileAuthPage,
    "Small-phone account recovery",
    "small-phone-recovery.png",
  );
  await mobileAuthPage.getByLabel("电子邮箱").fill(adminEmail);
  await mobileAuthPage.getByLabel("账户恢复码").fill(adminRecoveryCode);
  const recoveredPassword = crypto.randomBytes(24).toString("base64url");
  await mobileAuthPage.getByLabel("设置新密码").fill(recoveredPassword);
  await mobileAuthPage.getByLabel("确认密码").fill(recoveredPassword);
  await mobileAuthPage.getByRole("button", { name: "重设密码并进入" }).click();
  const nextRecoveryDialog = mobileAuthPage.getByRole("dialog", { name: "先保存账户恢复码" });
  await nextRecoveryDialog.waitFor();
  await waitForRecoveryDialogAnimation(mobileAuthPage);
  await assertAccessible(mobileAuthPage, "rotated recovery code dialog");
  const renewedRecoveryCode = await nextRecoveryDialog.locator(".recovery-code-value").innerText();
  assert.match(renewedRecoveryCode, /^[A-Za-z0-9_-]{40,}$/);
  assert.notEqual(renewedRecoveryCode, adminRecoveryCode);
  await nextRecoveryDialog.getByLabel("我已将恢复码保存在安全位置").check();
  await nextRecoveryDialog.getByRole("button", { name: "进入我的空间" }).click();
  await mobileAuthPage.getByRole("heading", { name: /接下来/ }).waitFor();
  const recoveredAccount = await mobileAuthPage.evaluate(async () => {
    const response = await fetch("/api/auth/me");
    return response.json();
  });
  assert.equal(recoveredAccount.user?.email, adminEmail);
  assert.equal(recoveredAccount.user?.recoveryCodeConfigured, true);
  check(true, "Recover an account from the mobile login screen with its one-time code");
  check(true, "Mobile registration, login, and recovery screens fit the viewport");
  await mobileAuthContext.close();
  mobileAuthContext = undefined;

  await context.close();
} finally {
  await mobileAuthContext?.close();
  await requestContext?.dispose();
  await browser?.close();
  database ||= new Database(resolveDatabasePath(), {
    timeout: 10_000,
  });
  database.transaction(() => {
    for (const email of [adminEmail, memberEmail]) {
      const user = database.prepare("SELECT id FROM users WHERE email = ?").get(email);
      if (!user) continue;
      database.prepare("DELETE FROM ai_usage WHERE user_id = ?").run(user.id);
      database.prepare("DELETE FROM knowledge_documents WHERE user_id = ?").run(user.id);
      database.prepare("DELETE FROM workspaces WHERE user_id = ?").run(user.id);
      database.prepare("DELETE FROM users WHERE id = ?").run(user.id);
    }
  })();
  database.close();
}

for (const checkpoint of checkpoints) console.log(`✓ ${checkpoint}`);
console.log(`VHFXNEX UI smoke check passed (${checkpoints.length} checkpoints).`);
console.log(`UI screenshots: ${screenshots}`);
