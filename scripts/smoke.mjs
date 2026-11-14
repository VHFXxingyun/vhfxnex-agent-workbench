import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDeepSeek } from "@ai-sdk/deepseek";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import JSZip from "jszip";
import { generateText } from "ai";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { configuredTrustedProxyHops, resolveClientAddress } from "../src/lib/client-address.mjs";
import { missingInitialAgentOutputs } from "../src/lib/agent-validation.mjs";
import {
  parseToolArguments,
  projectFileRequirements,
  toolDescriptions,
  toolSchemas,
} from "../src/lib/agent-tools.mjs";
import { agentToolCatalog } from "../src/lib/agent-tool-catalog.mjs";
import { agentOutputTokenBudget } from "../src/lib/agent-output-budget.mjs";
import { mergeExecutionCheckpoint } from "../src/lib/execution-checkpoint.mjs";
import { markPlanChecklistItemsPending } from "../src/lib/plan-markdown.mjs";
import { isSupportedChatTextFile, readChatDocument } from "../src/lib/attachment-reader.mjs";
import { buildStaticPreviewDocument } from "../src/lib/static-preview.mjs";
import { validateGeneratedProject } from "../src/lib/project-static-validation.mjs";
import {
  mergeProjectFilePatch,
  normalizeProjectPath,
  projectPathKey,
} from "../src/lib/project-path.mjs";
import { classifyProjectIntent } from "../src/lib/project-intent.mjs";
import { createCalendarExport, inspectCalendarSchedule } from "../src/lib/calendar-export.mjs";
import {
  estimateDeepSeekFlashCost,
  isDeepSeekFlashModel,
} from "../src/lib/deepseek-cost-estimate.mjs";
import { createAdminUsageCsv } from "../src/lib/admin-usage-export.mjs";
import { getDeepSeekApiKey, parseEnvValue } from "../src/lib/deepseek-key.mjs";
import {
  getDeepSeekCacheHitTokens,
  getDeepSeekReasoningTokens,
  parseDeepSeekUsage,
} from "../src/lib/deepseek-usage.mjs";
import { getDeepSeekUserId } from "../src/lib/deepseek-user-id.mjs";
import { hashPassword, needsPasswordUpgrade, verifyPassword } from "../src/lib/password.mjs";
import { isSessionSecretValid, MIN_SESSION_SECRET_BYTES } from "../src/lib/session-secret.mjs";
import { parseDuckDuckGoResults, searchDuckDuckGo } from "../src/lib/web-search.mjs";
import { compactToolFailure } from "../src/lib/tool-failure.mjs";
import { deepSeekThinkingOptions, normalizeThinkingMode } from "../src/lib/thinking-mode.mjs";
import { parsePlannerResponse, PLANNER_MAX_OUTPUT_TOKENS } from "../src/lib/planner-response.mjs";
import { classifySearchIntent } from "../src/lib/search-intent.mjs";
import { fuseKnowledgeSources } from "../src/lib/knowledge-ranking.mjs";
import { selectKnowledgeChunkIndexes } from "../src/lib/knowledge-chunks.mjs";
import { KNOWLEDGE_EMBEDDING_VERSION } from "../src/lib/knowledge-embeddings-core.mjs";
import {
  buildExecutionSystemPrompt,
  EXECUTION_PROMPT_STABLE_PREFIX,
} from "../src/lib/execution-prompt.mjs";
import {
  findScheduleConflict,
  normalizeScheduleDay,
  normalizeTimeRange,
  timeRangesOverlap,
} from "../src/lib/schedule-validation.mjs";
import { validateExecutionFeasibility } from "../src/lib/feasibility-validation.mjs";
import {
  requiresExecutionFeasibilityCheck,
  shouldReviewExistingExecutionFeasibility,
} from "../src/lib/feasibility-intent.mjs";
import {
  latestDraftDocumentEventIndex,
  nextExecutionFeasibilityTool,
} from "../src/lib/execution-feasibility-gate.mjs";
import {
  buildWorkspaceProgressAnswer,
  isWorkspaceProgressQuestion,
} from "../src/lib/workspace-progress-answer.mjs";
import { buildDialogueWorkspaceContext } from "../src/lib/dialogue-context.mjs";
import { availableCapacity, keepWithinLimit } from "../src/lib/workspace-capacity.mjs";
import { createWorkspaceExecutionLeaseStore } from "../src/lib/workspace-execution-lease.mjs";
import { resolveDatabasePath } from "../src/lib/database-path.mjs";
import {
  createSmokeDatabaseProof,
  matchesSmokeDatabaseProof,
} from "../src/lib/smoke-database-proof.mjs";
import {
  assertSmokeTargetMatchesDatabase,
  loadSmokeEnvironmentOrExit,
} from "./smoke-environment.mjs";
import { BUDGET_AMOUNT_LIMIT, normalizeBudgetItems } from "../src/lib/budget-validation.mjs";
import {
  AI_RATE_LIMITS,
  consumeRateLimitPolicies,
  createAiRateLimitPolicies,
  hashRateLimitKey,
} from "../src/lib/rate-limit-policy.mjs";

loadSmokeEnvironmentOrExit();
const baseUrl = new URL(process.env.NEXORA_BASE_URL || "http://localhost:3000");
const liveMode = process.argv.includes("--live");
const smokeClientAddress = `198.51.100.${crypto.randomInt(1, 255)}`;
if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(baseUrl.hostname)) {
  throw new Error("The smoke check only runs against a local NEXORA server.");
}

const checkpoints = [];
let smokeServerUnavailable = false;
let database;
let rateLimitDatabase;
let testUserId;
let recoveryCode;
const testUserIds = [];
const livePlanWorkspaceIds = [];
let sessionCookie;
const password = crypto.randomBytes(24).toString("base64url");
const email = `nexora-smoke-${crypto.randomUUID()}@example.test`;
const outsiderPassword = crypto.randomBytes(24).toString("base64url");
const outsiderEmail = `nexora-smoke-outsider-${crypto.randomUUID()}@example.test`;
const concurrentEmail = `nexora-smoke-race-${crypto.randomUUID()}@example.test`;

function makePdfFixture(pageCount = 1) {
  const pageIds = Array.from({ length: pageCount }, (_, index) => 4 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let index = 0; index < pageCount; index += 1) {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const stream = `BT /F1 16 Tf 72 720 Td (Page ${index + 1}: PDF attachment text) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
    );
  }

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

async function request(
  route,
  { method = "GET", body, cookie, headers: extraHeaders, timeoutMs = 15_000 } = {},
) {
  const headers = { Accept: "application/json" };
  headers["X-Forwarded-For"] = smokeClientAddress;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  Object.assign(headers, extraHeaders);
  const response = await fetch(new URL(route, baseUrl), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let payload;
  let streamEvents = [];
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const text = await response.text();
    streamEvents = text
      .split(/\r?\n\r?\n/)
      .filter(Boolean)
      .map((block) => {
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        return JSON.parse(data);
      });
    const failure = streamEvents.find((event) => event.type === "error");
    payload =
      streamEvents.find((event) => event.type === "result")?.data ||
      (failure ? { error: failure.error } : null);
  } else {
    payload = await response.json().catch(() => null);
  }
  return { response, payload, streamEvents };
}

function check(condition, message) {
  assert.ok(condition, message);
  checkpoints.push(message);
}

function checkExecutionLeaseStore() {
  const leaseDatabase = new Database(":memory:");
  leaseDatabase.exec(`
    CREATE TABLE workspaces (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE workspace_members (
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
      PRIMARY KEY (workspace_id, user_id)
    );
    CREATE TABLE workspace_execution_locks (
      workspace_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  leaseDatabase
    .prepare("INSERT INTO workspaces (id, user_id) VALUES (?, ?)")
    .run("lease-workspace", "lease-user");
  leaseDatabase
    .prepare("INSERT INTO workspaces (id, user_id) VALUES (?, ?)")
    .run("shared-workspace", "workspace-owner");
  leaseDatabase
    .prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)")
    .run("shared-workspace", "workspace-editor", "editor");
  const leases = createWorkspaceExecutionLeaseStore(leaseDatabase, 60_000);

  assert.deepEqual(leases.acquire("lease-user", "missing-workspace", "missing-token"), {
    status: "missing",
  });
  assert.deepEqual(leases.acquire("lease-user", "lease-workspace", "first-token"), {
    status: "acquired",
    token: "first-token",
  });
  assert.deepEqual(leases.acquire("workspace-editor", "shared-workspace", "editor-token"), {
    status: "acquired",
    token: "editor-token",
  });
  leases.release("workspace-editor", "shared-workspace", "editor-token");
  assert.deepEqual(leases.acquire("workspace-viewer", "shared-workspace", "viewer-token"), {
    status: "missing",
  });
  assert.deepEqual(leases.acquire("lease-user", "lease-workspace", "second-token"), {
    status: "busy",
  });
  assert.equal(leases.refresh("lease-user", "lease-workspace", "second-token"), false);
  assert.equal(leases.refresh("lease-user", "lease-workspace", "first-token"), true);
  leases.release("lease-user", "lease-workspace", "second-token");
  assert.deepEqual(leases.acquire("lease-user", "lease-workspace", "second-token"), {
    status: "busy",
  });

  leaseDatabase
    .prepare("UPDATE workspace_execution_locks SET expires_at = 0 WHERE workspace_id = ?")
    .run("lease-workspace");
  assert.equal(leases.refresh("lease-user", "lease-workspace", "first-token"), false);
  assert.deepEqual(leases.acquire("lease-user", "lease-workspace", "second-token"), {
    status: "acquired",
    token: "second-token",
  });
  leases.release("lease-user", "lease-workspace", "first-token");
  assert.deepEqual(leases.acquire("lease-user", "lease-workspace", "third-token"), {
    status: "busy",
  });
  leases.release("lease-user", "lease-workspace", "second-token");
  assert.deepEqual(leases.acquire("lease-user", "lease-workspace", "third-token"), {
    status: "acquired",
    token: "third-token",
  });
  leases.release("lease-user", "lease-workspace", "third-token");
  leaseDatabase.close();
  check(true, "Acquire, renew, expire, replace, and safely release workspace execution leases");

  const smokeProofPath = path.join(os.tmpdir(), "vhfxnex-smoke-proof.sqlite");
  const smokeProofSecret = "isolated-smoke-proof-secret-for-test-only";
  const smokeProof = createSmokeDatabaseProof(smokeProofPath, smokeProofSecret);
  assert.equal(matchesSmokeDatabaseProof(smokeProof, smokeProofPath, smokeProofSecret), true);
  assert.equal(
    matchesSmokeDatabaseProof(
      smokeProof,
      path.join(os.tmpdir(), "different-smoke-proof.sqlite"),
      smokeProofSecret,
    ),
    false,
  );
  assert.equal(
    matchesSmokeDatabaseProof(smokeProof, smokeProofPath, `${smokeProofSecret}-other`),
    false,
  );
  check(true, "Bind the local smoke preflight to the matching SQLite path without exposing it");
}

function checkDialogueWorkspaceContext() {
  const tasks = Array.from({ length: 24 }, (_, index) => ({
    id: `task-${index}`,
    title: `任务 ${index}`,
    detail: "任务细节。".repeat(80),
    phase: "执行",
    status: index < 4 ? "done" : "pending",
  }));
  const workspace = {
    prompt: "制作一个完整项目",
    selectedRouteId: "route-1",
    plan: {
      title: "演示项目",
      category: "软件项目",
      summary: "项目摘要",
      routes: [{ id: "route-1", title: "稳定路线" }],
      tasks,
    },
    result: {
      summary: "执行摘要",
      tasks,
      artifacts: Array.from({ length: 9 }, (_, index) => ({
        id: `artifact-${index}`,
        title: `成果 ${index}`,
        type: "document",
        description: "成果说明。".repeat(80),
        content: "ARTIFACT_PRIVATE_CONTENT_SENTINEL",
        files: [{ path: "private/full/source/path.txt", content: "FILE_PRIVATE_CONTENT_SENTINEL" }],
      })),
    },
  };
  const context = buildDialogueWorkspaceContext(workspace);
  const serialized = JSON.stringify(context);
  assert.equal(context.taskProgress.total, 24);
  assert.equal(context.taskProgress.completed, 4);
  assert.equal(context.taskProgress.omitted, 12);
  assert.equal(context.tasks.length, 12);
  assert.equal(context.recentDeliverables.length, 5);
  assert.equal(context.omittedDeliverables, 4);
  assert.deepEqual(context.recentDeliverables[0].fileNames, ["path.txt"]);
  assert.ok(serialized.length < 8_000, "dialogue context should have a bounded size");
  assert.ok(!serialized.includes("ARTIFACT_PRIVATE_CONTENT_SENTINEL"));
  assert.ok(!serialized.includes("FILE_PRIVATE_CONTENT_SENTINEL"));
  assert.ok(!serialized.includes("private/full/source/path.txt"));
  check(true, "Keep dialogue context compact while preserving progress and full workbench state");
}

function checkAdminUsageCsvExport() {
  const csv = createAdminUsageCsv([
    {
      source: "reviewer",
      operation: "execute",
      model: "deepseek-flash",
      workspaceTitle: '=HYPERLINK("https://attacker.invalid","open")',
      inputTokens: 1_000,
      outputTokens: 250,
      reasoningTokens: 8,
      cacheMeasuredInputTokens: 500,
      cacheMeasuredHitTokens: 125,
      latencyMs: 800,
      createdAt: "2026-11-14T12:00:00.000Z",
    },
  ]);
  assert.ok(csv.startsWith('\uFEFF"时间（北京时间）"'));
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/attacker\.invalid"",""open""\)"/);
  assert.ok(csv.includes('"代码复核 Agent"'));
  assert.ok(csv.includes('"1000"'));
  assert.ok(csv.includes('"125"'));
  assert.ok(csv.includes('"375"'));
  assert.ok(csv.includes('"已命中"'));
  assert.doesNotMatch(csv, /userId|email|prompt|attachment/i);
  check(true, "Export recent usage as UTF-8 CSV while neutralizing spreadsheet formulas");
}

try {
  await assertSmokeTargetMatchesDatabase(baseUrl);

  checkExecutionLeaseStore();
  checkDialogueWorkspaceContext();
  checkAdminUsageCsvExport();
  const envTestDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "nexora-env-smoke-"));
  const inheritedApiKey = process.env.DEEPSEEK_API_KEY;
  const disableAiOverride = process.env.NEXORA_DISABLE_AI;
  try {
    fs.writeFileSync(
      path.join(envTestDirectory, ".env.local"),
      'OTHER_VALUE=ignored\nDEEPSEEK_API_KEY="file-test-key" # inline comment\n',
    );
    delete process.env.NEXORA_DISABLE_AI;
    process.env.DEEPSEEK_API_KEY = "inherited-test-key";
    assert.equal(getDeepSeekApiKey(envTestDirectory), "file-test-key");
    process.env.NEXORA_DISABLE_AI = "1";
    assert.equal(
      getDeepSeekApiKey(envTestDirectory),
      "",
      "an explicit AI-off runtime must ignore a configured local credential",
    );
    delete process.env.NEXORA_DISABLE_AI;
    assert.equal(
      parseEnvValue(
        "# DEEPSEEK_API_KEY=commented\nexport DEEPSEEK_API_KEY = bare-key",
        "DEEPSEEK_API_KEY",
      ),
      "bare-key",
    );
    assert.equal(
      parseEnvValue("DEEPSEEK_API_KEY=old-key\nDEEPSEEK_API_KEY=new-key", "DEEPSEEK_API_KEY"),
      "new-key",
    );
  } finally {
    if (inheritedApiKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = inheritedApiKey;
    if (disableAiOverride === undefined) delete process.env.NEXORA_DISABLE_AI;
    else process.env.NEXORA_DISABLE_AI = disableAiOverride;
    fs.rmSync(envTestDirectory, { recursive: true, force: true });
  }
  check(true, "Read the DeepSeek credential from .env.local and ignore inherited environment keys");

  const flashEstimate = estimateDeepSeekFlashCost({
    inputTokens: 1_000_000,
    outputTokens: 100_000,
    cacheMeasuredInputTokens: 600_000,
    cacheMeasuredHitTokens: 300_000,
  });
  assert.equal(flashEstimate.lowerUsd, 0.1071);
  assert.equal(flashEstimate.upperUsd, 0.3318);
  assert.equal(flashEstimate.unmeasuredInputTokens, 400_000);
  assert.deepEqual(flashEstimate.confirmedCacheSavingsUsd, {
    lower: 0.0441,
    upper: 0.0882,
  });
  assert.deepEqual(estimateDeepSeekFlashCost({}), {
    lowerUsd: 0,
    upperUsd: 0,
    measuredInputTokens: 0,
    measuredHitTokens: 0,
    unmeasuredInputTokens: 0,
    confirmedCacheSavingsUsd: { lower: 0, upper: 0 },
  });
  assert.equal(isDeepSeekFlashModel("deepseek-flash"), true);
  assert.equal(isDeepSeekFlashModel("deepseek-v4-flash"), true);
  assert.equal(isDeepSeekFlashModel("deepseek-v4-pro"), false);
  check(
    true,
    "Estimate current DeepSeek Flash token cost as a bounded USD range and count only confirmed cache savings",
  );

  const parsedUsage = parseDeepSeekUsage(
    {
      model: "deepseek-flash",
      usage: {
        prompt_tokens: 120,
        prompt_cache_hit_tokens: 80,
        prompt_tokens_details: { cached_tokens: 70 },
        completion_tokens: 25,
        completion_tokens_details: { reasoning_tokens: 9 },
        total_tokens: 145,
      },
    },
    12.6,
  );
  assert.deepEqual(parsedUsage, {
    model: "deepseek-flash",
    inputTokens: 120,
    cachedInputTokens: 80,
    cacheMeasuredInputTokens: 120,
    cacheMeasuredHitTokens: 80,
    outputTokens: 25,
    reasoningTokens: 9,
    reasoningMeasuredRequests: 1,
    totalTokens: 145,
    latencyMs: 13,
    requests: 1,
  });
  const nestedCacheUsage = parseDeepSeekUsage(
    {
      usage: {
        prompt_tokens: 40,
        prompt_cache_hit_tokens: null,
        prompt_tokens_details: { cached_tokens: 60 },
        completion_tokens: 4,
      },
    },
    1,
  );
  assert.equal(nestedCacheUsage?.cachedInputTokens, 40);
  assert.equal(nestedCacheUsage?.cacheMeasuredInputTokens, 40);
  assert.equal(nestedCacheUsage?.cacheMeasuredHitTokens, 40);
  const alternateReasoningUsage = parseDeepSeekUsage(
    {
      usage: {
        prompt_tokens: 12,
        completion_tokens: 8,
        output_tokens_details: { reasoning_tokens: 99 },
        total_tokens: 20,
      },
    },
    1,
  );
  assert.equal(alternateReasoningUsage?.reasoningTokens, 8);
  assert.equal(alternateReasoningUsage?.reasoningMeasuredRequests, 1);
  const missOnlyCacheUsage = parseDeepSeekUsage(
    {
      usage: {
        prompt_tokens: 120,
        prompt_cache_miss_tokens: 90,
        completion_tokens: 4,
      },
    },
    1,
  );
  assert.equal(missOnlyCacheUsage?.cachedInputTokens, 30);
  assert.equal(missOnlyCacheUsage?.cacheMeasuredInputTokens, 120);
  assert.equal(missOnlyCacheUsage?.cacheMeasuredHitTokens, 30);
  assert.equal(
    parseDeepSeekUsage({ usage: { prompt_tokens: 40, completion_tokens: 4 } }, 1)
      ?.cachedInputTokens,
    undefined,
  );
  assert.equal(
    parseDeepSeekUsage({ usage: { prompt_tokens: 40, completion_tokens: 4 } }, 1)
      ?.cacheMeasuredInputTokens,
    undefined,
  );
  assert.equal(getDeepSeekCacheHitTokens({ prompt_cache_hit_tokens: 0 }, 120), 0);
  assert.equal(getDeepSeekCacheHitTokens({ prompt_tokens_details: { cached_tokens: 60 } }, 40), 40);
  assert.equal(getDeepSeekCacheHitTokens({ prompt_cache_miss_tokens: 90 }, 120), 30);
  assert.equal(getDeepSeekCacheHitTokens({ prompt_cache_miss_tokens: 160 }, 120), 0);
  assert.equal(
    getDeepSeekCacheHitTokens({ prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 100 }, 120),
    20,
  );
  assert.equal(getDeepSeekCacheHitTokens({}, 120), undefined);
  assert.equal(getDeepSeekCacheHitTokens({ prompt_cache_hit_tokens: "0" }, 120), undefined);
  assert.equal(getDeepSeekReasoningTokens({}, 20), undefined);
  assert.equal(
    getDeepSeekReasoningTokens({ completion_tokens_details: { reasoning_tokens: 0 } }, 20),
    0,
  );
  assert.equal(
    getDeepSeekReasoningTokens({ completion_tokens_details: { reasoning_tokens: "4" } }, 20),
    undefined,
  );
  check(true, "Preserve DeepSeek cache hit/miss telemetry and clamp invalid provider counts");
  check(true, "Distinguish raw provider cache telemetry from SDK-normalized zero defaults");

  const isolatedDeepSeekUserId = getDeepSeekUserId("account-1", "test-session-secret");
  assert.match(isolatedDeepSeekUserId, /^vhfxnex_[a-f0-9]{64}$/);
  assert.equal(getDeepSeekUserId("account-1", "test-session-secret"), isolatedDeepSeekUserId);
  assert.notEqual(getDeepSeekUserId("account-2", "test-session-secret"), isolatedDeepSeekUserId);
  assert.notEqual(getDeepSeekUserId("account-1", "rotated-session-secret"), isolatedDeepSeekUserId);
  assert.equal(isolatedDeepSeekUserId.includes("account-1"), false);
  assert.throws(() => getDeepSeekUserId("", "test-session-secret"), /non-empty/);
  const originalNodeEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(() => getDeepSeekUserId("account-1", ""), /SESSION_SECRET/);
  } finally {
    if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnvironment;
  }
  const deepSeekRequestPaths = [
    ["src/app/api/plan/route.ts", "user_id", 1],
    ["src/app/api/chat/route.ts", "userId", 1],
    ["src/app/api/execute/route.ts", "userId", 2],
    ["src/app/api/admin/ai-status/route.ts", "user_id", 1],
  ];
  for (const [routePath, field, expectedCalls] of deepSeekRequestPaths) {
    const routeSource = fs.readFileSync(path.join(process.cwd(), routePath), "utf8");
    const userIdCalls = routeSource.match(
      new RegExp(`${field}:\\s*getDeepSeekUserId\\(user\\.id\\)`, "g"),
    );
    assert.equal(
      userIdCalls?.length || 0,
      expectedCalls,
      `${routePath} should isolate every request`,
    );
  }
  check(
    true,
    "Derive pseudonymous DeepSeek IDs and pass them through every model-backed app route",
  );

  let capturedDeepSeekRequest;
  const testDeepSeekProvider = createDeepSeek({
    apiKey: "local-smoke-only",
    fetch: async (_input, init) => {
      capturedDeepSeekRequest = JSON.parse(init.body);
      return Response.json({
        id: "local-smoke",
        object: "chat.completion",
        created: 1,
        model: "deepseek-flash",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "ok" },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
          prompt_cache_hit_tokens: 0,
          prompt_cache_miss_tokens: 1,
        },
      });
    },
  });
  const isolatedProviderUserId = "vhfxnex_0123456789abcdef";
  const mockedProviderResult = await generateText({
    model: testDeepSeekProvider("deepseek-flash"),
    prompt: "local provider smoke",
    providerOptions: { deepseek: { userId: isolatedProviderUserId } },
  });
  assert.equal(capturedDeepSeekRequest?.user_id, isolatedProviderUserId);
  assert.equal(mockedProviderResult.text, "ok");
  check(true, "Serialize the pseudonymous account ID as DeepSeek user_id without a live API call");

  assert.equal(isSessionSecretValid("s".repeat(MIN_SESSION_SECRET_BYTES - 1)), false);
  assert.equal(isSessionSecretValid("s".repeat(MIN_SESSION_SECRET_BYTES)), true);
  assert.equal(isSessionSecretValid("🔐".repeat(8)), true);
  check(true, "Require at least 32 UTF-8 bytes for session signing secrets");

  const forwardedHeaders = new Headers({
    "x-forwarded-for": "192.0.2.44, 203.0.113.18, 198.51.100.9",
    "x-real-ip": "198.51.100.9",
  });
  assert.equal(resolveClientAddress(forwardedHeaders, 0), "unattributed-client");
  assert.equal(resolveClientAddress(forwardedHeaders, 1), "198.51.100.9");
  assert.equal(resolveClientAddress(forwardedHeaders, 2), "203.0.113.18");
  assert.equal(
    resolveClientAddress(new Headers({ "x-forwarded-for": "attacker-controlled-value" }), 1),
    "unattributed-client",
  );
  assert.equal(configuredTrustedProxyHops({ NODE_ENV: "production" }), 0);
  assert.equal(configuredTrustedProxyHops({ NODE_ENV: "development" }), 1);
  assert.equal(
    configuredTrustedProxyHops({ NODE_ENV: "production", NEXORA_TRUSTED_PROXY_HOPS: "2" }),
    2,
  );
  assert.equal(
    configuredTrustedProxyHops({ NODE_ENV: "production", NEXORA_TRUSTED_PROXY_HOPS: "99" }),
    0,
  );
  check(true, "Trust forwarded client addresses only through a configured proxy chain");

  rateLimitDatabase = new Database(":memory:");
  rateLimitDatabase.exec(`
    CREATE TABLE auth_rate_limits (
      key_hash TEXT PRIMARY KEY,
      window_started_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL
    );
  `);
  const fixedNow = 1_800_000_000_000;
  const planPolicies = createAiRateLimitPolicies("plan", "smoke-user", "198.51.100.42");
  const executePolicies = createAiRateLimitPolicies("execute", "smoke-user", "198.51.100.42");
  assert.equal(AI_RATE_LIMITS.perOperationAccount, 12);
  assert.deepEqual(
    planPolicies.map(({ key, limit }) => ({ key, limit })),
    [
      { key: "ai:plan:account:smoke-user", limit: 12 },
      { key: "ai:account:smoke-user", limit: 20 },
      { key: "ai:plan:address:198.51.100.42", limit: 60 },
      { key: "ai:address:198.51.100.42", limit: 120 },
    ],
  );
  assert.equal(hashRateLimitKey(planPolicies[0].key, "smoke-secret").length, 64);
  for (let attempt = 0; attempt < AI_RATE_LIMITS.perOperationAccount; attempt++) {
    assert.deepEqual(
      consumeRateLimitPolicies(rateLimitDatabase, "smoke-secret", planPolicies, fixedNow),
      {
        allowed: true,
      },
    );
  }
  assert.deepEqual(
    consumeRateLimitPolicies(rateLimitDatabase, "smoke-secret", planPolicies, fixedNow + 1_000),
    { allowed: false, retryAfterSeconds: 899 },
  );
  assert.equal(
    rateLimitDatabase
      .prepare("SELECT attempts FROM auth_rate_limits WHERE key_hash = ?")
      .get(hashRateLimitKey(planPolicies[2].key, "smoke-secret")).attempts,
    AI_RATE_LIMITS.perOperationAccount,
    "a rejected request must not increment another quota bucket",
  );
  for (let attempt = 0; attempt < 8; attempt++) {
    assert.deepEqual(
      consumeRateLimitPolicies(rateLimitDatabase, "smoke-secret", executePolicies, fixedNow),
      { allowed: true },
    );
  }
  assert.deepEqual(
    consumeRateLimitPolicies(rateLimitDatabase, "smoke-secret", executePolicies, fixedNow),
    { allowed: false, retryAfterSeconds: 900 },
  );
  assert.deepEqual(
    consumeRateLimitPolicies(
      rateLimitDatabase,
      "smoke-secret",
      executePolicies,
      fixedNow + AI_RATE_LIMITS.windowMs,
    ),
    { allowed: true },
  );
  const sharedAddress = "198.51.100.77";
  for (let account = 1; account <= 5; account++) {
    const policies = createAiRateLimitPolicies("plan", `source-user-${account}`, sharedAddress);
    for (let attempt = 0; attempt < AI_RATE_LIMITS.perOperationAccount; attempt++) {
      assert.deepEqual(
        consumeRateLimitPolicies(rateLimitDatabase, "smoke-secret", policies, fixedNow),
        { allowed: true },
      );
    }
  }
  const sixthAccountPolicies = createAiRateLimitPolicies("plan", "source-user-6", sharedAddress);
  assert.deepEqual(
    consumeRateLimitPolicies(rateLimitDatabase, "smoke-secret", sixthAccountPolicies, fixedNow),
    { allowed: false, retryAfterSeconds: 900 },
  );
  assert.equal(
    rateLimitDatabase
      .prepare("SELECT attempts FROM auth_rate_limits WHERE key_hash = ?")
      .get(hashRateLimitKey(sixthAccountPolicies[0].key, "smoke-secret")),
    undefined,
    "a source-level rejection must not consume the new account's quota",
  );
  rateLimitDatabase.close();
  rateLimitDatabase = undefined;
  check(
    true,
    "Enforce account and shared-source AI quotas atomically, hash keys, and reset after 15 minutes",
  );

  const parsedTaskTool = parseToolArguments(
    "create_tasks",
    JSON.stringify({ tasks: [{ title: "  发送邀请  ", detail: "名单确认", phase: "筹备" }] }),
  );
  assert.deepEqual(parsedTaskTool, {
    ok: true,
    args: { tasks: [{ title: "发送邀请", detail: "名单确认", phase: "筹备" }] },
  });
  assert.equal(parseToolArguments("create_tasks", "{invalid").ok, false);
  assert.equal(
    parseToolArguments("build_schedule", JSON.stringify({ blocks: [{ date: "第 1 天" }] })).ok,
    false,
  );
  assert.equal(
    parseToolArguments(
      "validate_feasibility",
      JSON.stringify({
        blocks: [
          {
            date: "第 1 天",
            time: "09:00-10:00",
            activity: "签到",
            staff: [{ name: "小林", role: "签到" }],
          },
        ],
      }),
    ).ok,
    true,
  );
  assert.equal(parseToolArguments("unknown_tool", "{}").ok, false);
  assert.equal(
    markPlanChecklistItemsPending(
      "1. [x] 联系联办学院\n- [X] 招募志愿者\n- [ ] 已待办\n\n```md\n- [x] 代码示例\n```",
    ),
    "1. [ ] 联系联办学院\n- [ ] 招募志愿者\n- [ ] 已待办\n\n```md\n- [x] 代码示例\n```",
  );
  check(
    true,
    "Keep proposed action-plan checklist items pending and preserve fenced code examples",
  );
  assert.equal(Object.keys(toolSchemas).length, 11);
  assert.equal(agentOutputTokenBudget("create_tasks"), 2000);
  assert.equal(agentOutputTokenBudget("validate_feasibility"), 1800);
  assert.equal(agentOutputTokenBudget("draft_document"), 3600);
  assert.equal(agentOutputTokenBudget("generate_pdf"), 12_000);
  assert.equal(agentOutputTokenBudget("create_project"), 12_000);
  assert.equal(agentOutputTokenBudget(null), 1200);
  check(true, "Bound each Agent step's output tokens to the selected tool's actual needs");

  const sourceHeavyToolError = new Error(`Invalid project: ${"<html>".repeat(2_000)}`, {
    cause: new Error("Provider schema validation failed", {
      cause: Object.assign(new Error("Invalid project fields"), {
        issues: [
          {
            path: ["files"],
            message: "项目源文件不能超过 45 KB",
          },
        ],
      }),
    }),
  });
  assert.equal(compactToolFailure(sourceHeavyToolError), "files：项目源文件不能超过 45 KB");
  assert.equal(
    compactToolFailure(
      new Error("AI_InvalidToolInputError: AI_JSONParseError: JSON parsing failed"),
    ),
    "工具参数 JSON 不完整或被截断；请缩小本次产物范围后重新生成。",
  );
  assert.equal(
    compactToolFailure(
      new Error(
        `AI_InvalidToolInputError: AI_TypeValidationError: Type validation failed: Value: ${"<source>".repeat(2_000)}.\nError message: files：项目源文件不能超过 45 KB`,
      ),
    ),
    "files：项目源文件不能超过 45 KB",
  );
  check(true, "Keep tool repair feedback concise and preserve the actual schema issue");

  const envExample = new File(["API_KEY=example\n"], ".env.example", {
    type: "application/octet-stream",
  });
  assert.equal(isSupportedChatTextFile(envExample), true);
  assert.match(await readChatDocument(envExample), /API_KEY=example/);
  const docxZip = new JSZip();
  docxZip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  docxZip.file(
    "_rels/.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  docxZip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX attachment text works</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
  );
  const docxBytes = await docxZip.generateAsync({ type: "nodebuffer" });
  const docxFile = new File([docxBytes], "plan.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  assert.match(await readChatDocument(docxFile), /DOCX attachment text works/);
  const xlsxZip = new JSZip();
  xlsxZip.file(
    "xl/sharedStrings.xml",
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>活动 &amp; 预算</t></si></sst>',
  );
  xlsxZip.file(
    "xl/worksheets/sheet1.xml",
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>1200</t></is></c></row></sheetData></worksheet>',
  );
  const xlsxFile = new File([await xlsxZip.generateAsync({ type: "nodebuffer" })], "budget.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  assert.equal(isSupportedChatTextFile(xlsxFile), true);
  assert.match(await readChatDocument(xlsxFile), /活动 & 预算/);
  assert.match(await readChatDocument(xlsxFile), /B1=1200/);
  const pptxZip = new JSZip();
  pptxZip.file(
    "ppt/slides/slide1.xml",
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>活动目标与执行安排</a:t></p:sld>',
  );
  const pptxFile = new File([await pptxZip.generateAsync({ type: "nodebuffer" })], "brief.pptx", {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
  assert.equal(isSupportedChatTextFile(pptxFile), true);
  assert.match(await readChatDocument(pptxFile), /活动目标与执行安排/);
  const corruptOfficeFile = new File(["not an Office archive"], "broken.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  await assert.rejects(readChatDocument(corruptOfficeFile), /Office 文档无法打开/);
  const oversizedWorkbookZip = new JSZip();
  for (let index = 1; index <= 41; index += 1)
    oversizedWorkbookZip.file(`xl/worksheets/sheet${index}.xml`, "<worksheet/>");
  const oversizedWorkbook = new File(
    [await oversizedWorkbookZip.generateAsync({ type: "nodebuffer" })],
    "many-sheets.xlsx",
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  );
  await assert.rejects(readChatDocument(oversizedWorkbook), /最多读取 40 个工作表/);
  const oversizedPresentationZip = new JSZip();
  for (let index = 1; index <= 61; index += 1)
    oversizedPresentationZip.file(`ppt/slides/slide${index}.xml`, "<slide/>");
  const oversizedPresentation = new File(
    [await oversizedPresentationZip.generateAsync({ type: "nodebuffer" })],
    "many-slides.pptx",
    { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  );
  await assert.rejects(readChatDocument(oversizedPresentation), /最多读取 60 张幻灯片/);
  const pdfFile = new File([makePdfFixture()], "brief.pdf", { type: "application/pdf" });
  assert.match(await readChatDocument(pdfFile), /PDF attachment text/);
  const largePdf = new File([makePdfFixture(41)], "long.pdf", { type: "application/pdf" });
  await assert.rejects(readChatDocument(largePdf), /PDF 最多读取 40 页/);
  const oversizedText = new File([Buffer.alloc(5_000_001)], "large.txt", { type: "text/plain" });
  await assert.rejects(readChatDocument(oversizedText), /不能超过 5 MB/);
  const emptyText = new File(["  \n\t"], "empty.txt", { type: "text/plain" });
  await assert.rejects(readChatDocument(emptyText), /没有从这个文档中读取到文字/);
  assert.equal(isSupportedChatTextFile(new File(["binary"], "program.exe")), false);
  check(
    true,
    "Extract Office/PDF/text attachments, reject corrupt packages, and enforce document, sheet, slide, and page limits",
  );

  const staticPreview = buildStaticPreviewDocument([
    {
      path: "index.html",
      content:
        '<!doctype html><html><head><link rel="stylesheet" href="./styles.css"><script>alert(1)</script><meta http-equiv="refresh" content="0;url=https://example.com"></head><body><a href="https://example.com">external</a></body></html>',
    },
    { path: "styles.css", content: "body { color: #333; }" },
    { path: "../outside.css", content: "body { color: red; }" },
  ]);
  assert.ok(staticPreview);
  assert.match(staticPreview, /connect-src 'none'/);
  assert.match(staticPreview, /<style>body \{ color: #333; \}<\/style>/);
  assert.doesNotMatch(staticPreview, /<script\b/i);
  assert.doesNotMatch(staticPreview, /http-equiv="refresh"/i);
  assert.doesNotMatch(staticPreview, /href="https:\/\/example\.com"/i);
  assert.equal(buildStaticPreviewDocument([{ path: "README.md", content: "no preview" }]), null);
  const escapedStylePreview = buildStaticPreviewDocument([
    {
      path: "index.html",
      content: '<html><head><link rel="stylesheet" href="styles.css"></head></html>',
    },
    { path: "styles.css", content: 'body::after { content: "</style><script>bad</script>"; }' },
  ]);
  assert.ok(escapedStylePreview);
  assert.doesNotMatch(escapedStylePreview, /<\/style><script>/i);
  const unicodeAssetPreview = buildStaticPreviewDocument([
    {
      path: "index.html",
      content:
        '<html><head><link rel="stylesheet" href="./样式/café.css"></head><body>localized</body></html>',
    },
    { path: "样式/cafe\u0301.css", content: "body { color: teal; }" },
  ]);
  assert.match(unicodeAssetPreview || "", /body \{ color: teal; \}/);
  check(true, "Build HTML previews without scripts, external navigation, or network access");
  assert.equal(
    parseToolArguments("search_web", JSON.stringify({ query: "Next.js docs" })).ok,
    true,
  );
  assert.equal(parseToolArguments("search_web", JSON.stringify({ query: "x" })).ok, false);
  assert.deepEqual(classifySearchIntent("请联网搜索 Next.js 官方文档"), {
    requiresSearch: true,
    explicitlyDisabled: false,
  });
  assert.deepEqual(classifySearchIntent("不要联网搜索，直接根据我给的材料回答"), {
    requiresSearch: false,
    explicitlyDisabled: true,
  });
  assert.deepEqual(classifySearchIntent("不要在网上搜索，直接按附件回答"), {
    requiresSearch: false,
    explicitlyDisabled: true,
  });
  assert.deepEqual(classifySearchIntent("请搜索官方文档，但不要搜索论坛"), {
    requiresSearch: true,
    explicitlyDisabled: false,
  });
  assert.deepEqual(classifySearchIntent("不要搜索论坛，直接根据材料回答"), {
    requiresSearch: false,
    explicitlyDisabled: false,
  });
  assert.deepEqual(classifySearchIntent("只根据我上传的附件回答，不需要补充网络资料"), {
    requiresSearch: false,
    explicitlyDisabled: true,
  });
  assert.deepEqual(classifySearchIntent("不要联网搜索，但请查官网确认"), {
    requiresSearch: true,
    explicitlyDisabled: false,
  });
  check(
    true,
    "Respect explicit no-web instructions while retaining scoped source exclusions and later search overrides",
  );
  const executionPromptVariants = [
    buildExecutionSystemPrompt({ isContinuation: false, searchPolicy: "optional" }),
    buildExecutionSystemPrompt({
      isContinuation: true,
      projectInstructions: "必须生成完整代码项目。",
      needsSpreadsheet: true,
      needsPresentation: true,
      needsPdf: true,
      searchPolicy: "required",
    }),
    buildExecutionSystemPrompt({ isContinuation: true, searchPolicy: "disabled" }),
  ];
  assert.ok(
    executionPromptVariants.every((prompt) => prompt.startsWith(EXECUTION_PROMPT_STABLE_PREFIX)),
  );
  assert.match(executionPromptVariants[0], /这是新目标/);
  assert.match(executionPromptVariants[1], /补充指示是本轮唯一的变更依据/);
  assert.match(executionPromptVariants[1], /必须生成完整代码项目/);
  assert.match(executionPromptVariants[1], /必须调用 generate_spreadsheet/);
  assert.match(executionPromptVariants[1], /必须调用 generate_presentation/);
  assert.match(executionPromptVariants[1], /必须调用 generate_pdf/);
  assert.match(executionPromptVariants[1], /必须先调用 search_web/);
  assert.match(executionPromptVariants[2], /search_web 工具已禁用/);
  assert.match(EXECUTION_PROMPT_STABLE_PREFIX, /路线与产物一致性/);
  assert.match(EXECUTION_PROMPT_STABLE_PREFIX, /不能安排同一人同时负责两个岗位/);
  assert.match(
    EXECUTION_PROMPT_STABLE_PREFIX,
    /创建任务或方案不代表已对外联系、预订、招募或线下执行/,
  );
  assert.match(EXECUTION_PROMPT_STABLE_PREFIX, /必须调用 validate_feasibility 检查/);
  assert.match(EXECUTION_PROMPT_STABLE_PREFIX, /coverage\.complete 才表示所需数据完整/);
  assert.match(EXECUTION_PROMPT_STABLE_PREFIX, /coverage\.pending 中的待确认项/);
  assert.match(toolDescriptions.validate_feasibility, /coverage\.complete=false/);
  assert.match(EXECUTION_PROMPT_STABLE_PREFIX, /attendeeCount 只计参与者/);
  assert.match(
    EXECUTION_PROMPT_STABLE_PREFIX,
    /不在参与者和 staff 名单中的其他在场人员填入 unlistedOnsiteCount/,
  );
  assert.match(EXECUTION_PROMPT_STABLE_PREFIX, /纳入交付完成条件/);
  assert.match(EXECUTION_PROMPT_STABLE_PREFIX, /最后一次检查必须发生在最后一次方案文档修改之后/);
  assert.match(EXECUTION_PROMPT_STABLE_PREFIX, /不新增没收手机、禁止设备等强制限制/);
  check(
    true,
    "Keep a shared cacheable Agent policy prefix and check route, artifact, capacity, and completion consistency",
  );
  const semanticHits = [
    { id: "doc-a", title: "路线指南", excerpt: "语义相关片段", score: 0.88, matchType: "semantic" },
    { id: "doc-b", title: "报名规则", excerpt: "规则语义片段", score: 0.84, matchType: "semantic" },
  ];
  const keywordHits = [
    {
      id: "doc-b",
      title: "报名规则",
      excerpt: "包含目标精确词汇的原文",
      score: 0.61,
      matchType: "keyword",
    },
    {
      id: "doc-a",
      title: "路线指南",
      excerpt: "带关键词锚点的原文",
      score: 0.42,
      matchType: "keyword",
    },
    {
      id: "doc-c",
      title: "附加资料",
      excerpt: "只有关键词命中的资料",
      score: 0.2,
      matchType: "keyword",
    },
  ];
  const hybridHits = fuseKnowledgeSources(semanticHits, keywordHits, 3);
  assert.deepEqual(
    hybridHits.map(({ id }) => id),
    ["doc-a", "doc-b", "doc-c"],
  );
  assert.deepEqual(
    hybridHits.map(({ matchType }) => matchType),
    ["hybrid", "hybrid", "keyword"],
  );
  assert.equal(hybridHits[1]?.excerpt, "包含目标精确词汇的原文");
  assert.equal(fuseKnowledgeSources(semanticHits, keywordHits, 0).length, 0);
  check(
    true,
    "Fuse semantic and exact-keyword knowledge hits while retaining source-grounding excerpts",
  );

  assert.deepEqual(selectKnowledgeChunkIndexes([3, 1]), [[0, 1, 2], [0]]);
  assert.deepEqual(selectKnowledgeChunkIndexes([0, 3]), [[], [0, 1, 2]]);
  assert.deepEqual(selectKnowledgeChunkIndexes([23, 12], 10), [
    [0, 6, 11, 17, 22],
    [0, 3, 6, 8, 11],
  ]);
  const largeKnowledgeIndexes = selectKnowledgeChunkIndexes(Array(100).fill(23));
  assert.equal(largeKnowledgeIndexes.flat().length, 600);
  assert.ok(largeKnowledgeIndexes.every((indexes) => indexes.length === 6));
  assert.ok(largeKnowledgeIndexes.every((indexes) => indexes[0] === 0 && indexes.at(-1) === 22));
  check(
    true,
    "Index all chunks in smaller knowledge bases and evenly bound semantic inference for larger ones",
  );
  const parsedWebResults = parseDuckDuckGoResults(
    '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fguide&amp;rut=x">Example &amp; Guide</a>' +
      '<a class="result__snippet" href="#">A useful &lt;strong&gt;summary&lt;/strong&gt;.</a>' +
      '<a class="result__a" href="javascript:alert(1)">Unsafe</a>' +
      '<a class="result__snippet" href="#">Ignore malformed result links.</a>',
  );
  assert.equal(parsedWebResults.length, 1);
  assert.equal(parsedWebResults[0].title, "Example & Guide");
  assert.equal(parsedWebResults[0].url, "https://example.com/guide");
  assert.equal(parsedWebResults[0].snippet, "A useful summary .");
  const malformedEntityResults = parseDuckDuckGoResults(
    '<a class="result__a" href="https://example.com">Invalid &#9999999; &#x110000;</a>' +
      '<a class="result__snippet" href="#">Safe summary.</a>',
  );
  assert.equal(malformedEntityResults[0]?.title, "Invalid � �");
  let oversizedSearchCancelled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(1_000_001));
        },
        cancel() {
          oversizedSearchCancelled = true;
        },
      }),
    );
  try {
    await assert.rejects(searchDuckDuckGo("bounded search"), /超过安全上限/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(oversizedSearchCancelled, true);
  check(true, "Bound search response bodies and tolerate malformed encoded entities");
  assert.equal(normalizeThinkingMode(undefined), "deep");
  assert.deepEqual(deepSeekThinkingOptions(normalizeThinkingMode(undefined)), {
    thinking: { type: "enabled" },
    reasoning_effort: "high",
  });
  assert.deepEqual(deepSeekThinkingOptions(normalizeThinkingMode("fast")), {
    thinking: { type: "disabled" },
  });
  assert.deepEqual(deepSeekThinkingOptions(normalizeThinkingMode("invalid")), {
    thinking: { type: "enabled" },
    reasoning_effort: "high",
  });
  check(true, "Default planning uses deep reasoning and the fast option disables it");
  assert.ok(PLANNER_MAX_OUTPUT_TOKENS >= 4000);
  assert.deepEqual(
    parsePlannerResponse({
      choices: [{ finish_reason: "stop", message: { content: '{"title":"ok"}' } }],
    }),
    { title: "ok" },
  );
  assert.throws(
    () =>
      parsePlannerResponse({
        choices: [{ finish_reason: "length", message: { content: '{"title":"partial"' } }],
      }),
    /达到长度上限/,
  );
  assert.throws(
    () =>
      parsePlannerResponse({
        choices: [{ finish_reason: "stop", message: { content: '{"title":' } }],
      }),
    /规划结果不完整/,
  );
  check(
    true,
    "Reject truncated or malformed plans and preserve enough output budget for deep planning",
  );
  assert.equal(
    parseToolArguments(
      "create_project",
      JSON.stringify({
        name: "桌面小伙伴",
        description: "一个能运行的桌宠演示",
        files: [
          { path: "index.html", content: "<!doctype html><title>pet</title>" },
          { path: "README.md", content: "# 运行\n直接打开 index.html" },
        ],
      }),
    ).ok,
    true,
  );
  assert.equal(
    parseToolArguments(
      "create_project",
      JSON.stringify({
        name: "unsafe",
        description: "不安全路径必须被拦截",
        files: [
          { path: "../index.html", content: "x" },
          { path: "README.md", content: "x" },
        ],
      }),
    ).ok,
    false,
  );
  assert.equal(normalizeProjectPath("src/活动 页面/入口 文件.tsx"), "src/活动 页面/入口 文件.tsx");
  assert.equal(normalizeProjectPath("C:/build/index.html"), null);
  assert.equal(normalizeProjectPath("docs/CON.txt"), null);
  assert.equal(normalizeProjectPath("assets/logo.png."), null);
  assert.equal(
    projectPathKey("docs/café.md"),
    projectPathKey("docs/cafe\u0301.md"),
    "path identity must normalize Unicode before comparing case-insensitive filenames",
  );
  const localizedProject = parseToolArguments(
    "create_project",
    JSON.stringify({
      name: "中文文件名项目",
      description: "文件名可按使用者语言组织",
      files: [
        { path: "README.md", content: "运行 npm run dev" },
        { path: "index.html", content: "<!doctype html><title>demo</title>" },
        { path: "src/活动 页面/入口 文件.tsx", content: "export default function Page() {}" },
      ],
    }),
  );
  assert.equal(localizedProject.ok, true);
  const normalizedDuplicateProject = parseToolArguments(
    "create_project",
    JSON.stringify({
      name: "规范化重复路径",
      description: "拒绝视觉相同的重复文件名",
      files: [
        { path: "README.md", content: "运行 npm run dev" },
        { path: "index.html", content: "<!doctype html><title>demo</title>" },
        { path: "docs/café.md", content: "a" },
        { path: "docs/cafe\u0301.md", content: "b" },
      ],
    }),
  );
  assert.equal(normalizedDuplicateProject.ok, false);
  const validGeneratedProject = validateGeneratedProject([
    { path: "README.md", content: "运行 npm run dev" },
    {
      path: "package.json",
      content: JSON.stringify({
        scripts: { dev: "vite" },
        devDependencies: { vite: "^7.0.0" },
      }),
    },
    { path: "src/main.ts", content: 'import { start } from "./start"; start();' },
    { path: "src/start.ts", content: "export function start() { return true; }" },
  ]);
  assert.deepEqual(validGeneratedProject, []);
  const missingGeneratedImport = validateGeneratedProject([
    { path: "src/main.ts", content: 'import "./missing.css";' },
  ]);
  assert.match(missingGeneratedImport.join(" "), /找不到本地引用.*missing\.css/);
  const invalidGeneratedSource = validateGeneratedProject([
    { path: "src/main.js", content: "export const = ;" },
  ]);
  assert.match(invalidGeneratedSource.join(" "), /src\/main\.js:\d+:\d+/);
  const invalidGeneratedManifest = validateGeneratedProject([
    { path: "package.json", content: JSON.stringify({ scripts: { dev: " " } }) },
  ]);
  assert.match(invalidGeneratedManifest.join(" "), /scripts 命令/);
  check(
    true,
    "Statically check generated project syntax, local references, and package manifests without running code",
  );
  check(
    true,
    "Accept safe Unicode project paths while rejecting traversal, Windows reserved names, and normalized duplicates",
  );
  assert.equal(classifyProjectIntent("请帮我生成一个校园活动报名网站"), "create");
  assert.equal(
    classifyProjectIntent("开始制作吧", {
      isContinuation: true,
      hasExistingProject: false,
      isSoftwareWorkspace: true,
    }),
    "create",
  );
  assert.equal(
    classifyProjectIntent("做到哪里了？", {
      isContinuation: true,
      hasExistingProject: false,
      isSoftwareWorkspace: true,
    }),
    null,
  );
  assert.equal(isWorkspaceProgressQuestion("这个项目现在到哪里了？"), true);
  assert.equal(isWorkspaceProgressQuestion("这个项目做到哪里了？"), true);
  assert.equal(isWorkspaceProgressQuestion("Agent 还在后台运行吗？"), true);
  assert.equal(isWorkspaceProgressQuestion("继续把剩下的代码补完"), false);
  assert.equal(isWorkspaceProgressQuestion("这个项目到哪里了，继续把代码补完"), false);
  assert.equal(isWorkspaceProgressQuestion("这个项目到哪里了，下一步怎么安排？"), false);
  const activeProgressAnswer = buildWorkspaceProgressAnswer({
    executionIsRunning: true,
    executionWasInterrupted: false,
    currentActivity: "正在生成可下载的代码项目",
    completedToolCalls: 2,
    tasks: [
      { title: "需求确认", status: "done" },
      { title: "生成项目源码", status: "pending" },
    ],
    artifacts: [{ title: "项目源码包" }],
  });
  assert.match(activeProgressAnswer, /正在后台运行/);
  assert.match(activeProgressAnswer, /正在生成可下载的代码项目/);
  assert.match(activeProgressAnswer, /已记录 2 次工具操作；这是活动记录，不代表项目完成百分比/);
  assert.match(activeProgressAnswer, /1\/2 项完成，1 项待推进/);
  assert.match(activeProgressAnswer, /项目源码包/);
  const otherWorkspaceProgressAnswer = buildWorkspaceProgressAnswer({
    executionIsRunning: false,
    executionWasInterrupted: false,
    globalExecution: { workspaceTitle: "旅行规划", activity: "正在整理交通方案" },
    resultSummary: "已完成初步需求梳理。",
    tasks: [],
  });
  assert.match(otherWorkspaceProgressAnswer, /Agent 正在「旅行规划」中运行：正在整理交通方案/);
  const interruptedProgressAnswer = buildWorkspaceProgressAnswer({
    executionIsRunning: false,
    executionWasInterrupted: true,
    latestExecutionMessage: "本轮连接已中断",
    resultSummary: "已保存 3 个源码文件。",
    tasks: [{ title: "补充运行说明", status: "pending" }],
  });
  assert.match(interruptedProgressAnswer, /当前没有任务在后台运行/);
  assert.match(interruptedProgressAnswer, /本轮连接已中断/);
  assert.match(interruptedProgressAnswer, /已保存 3 个源码文件/);
  const idleProgressAnswer = buildWorkspaceProgressAnswer({
    executionIsRunning: false,
    executionWasInterrupted: false,
    latestExecutionState: "completed",
    tasks: [],
  });
  assert.match(idleProgressAnswer, /最近一次执行已完成/);
  check(
    true,
    "Answer pure progress questions from workspace state without model calls and distinguish running, other-workspace, interrupted, and idle states",
  );
  assert.equal(
    classifyProjectIntent("把刚刚生成的网站主按钮改成紫色", {
      isContinuation: true,
      hasExistingProject: true,
    }),
    "update",
  );
  assert.equal(
    classifyProjectIntent("登录页的按钮没反应，帮我修复一下", {
      isContinuation: true,
      hasExistingProject: true,
    }),
    "update",
  );
  assert.equal(
    classifyProjectIntent("这个区域不能往下滑", {
      isContinuation: true,
      hasExistingProject: true,
    }),
    "update",
  );
  assert.equal(
    classifyProjectIntent("只新增一项任务：制作一个网页修复清单", {
      isContinuation: true,
      hasExistingProject: true,
      mustAddTask: true,
    }),
    null,
  );
  assert.equal(
    classifyProjectIntent("把按钮改成紫色", { isContinuation: true, hasExistingProject: false }),
    null,
  );
  const projectEditFiles = [
    { path: "README.md", content: "运行 npm run dev" },
    { path: "index.html", content: "<!doctype html><title>signup</title>" },
    { path: "styles.css", content: "button { color: purple; }" },
  ];
  const parsedProjectPatch = parseToolArguments(
    "create_project",
    JSON.stringify({
      name: "报名网站",
      description: "调整主按钮颜色",
      mode: "patch",
      files: [projectEditFiles[2]],
      deleteFiles: ["legacy.js"],
    }),
  );
  assert.equal(parsedProjectPatch.ok, true);
  const mergedProjectFiles = mergeProjectFilePatch(
    [
      projectEditFiles[0],
      projectEditFiles[1],
      { path: "styles.css", content: "button { color: red; }" },
      { path: "legacy.js", content: "window.oldWidget = true;" },
    ],
    parsedProjectPatch.args.files,
    parsedProjectPatch.args.deleteFiles,
  );
  assert.equal(
    mergedProjectFiles.find((file) => file.path === "styles.css").content,
    "button { color: purple; }",
  );
  assert.ok(mergedProjectFiles.some((file) => file.path === "README.md"));
  assert.ok(mergedProjectFiles.some((file) => file.path === "index.html"));
  assert.equal(
    mergedProjectFiles.some((file) => file.path === "legacy.js"),
    false,
  );
  assert.deepEqual(projectFileRequirements(mergedProjectFiles), []);
  assert.equal(
    parseToolArguments(
      "create_project",
      JSON.stringify({
        name: "不安全修改",
        description: "删除路径不能越界",
        mode: "patch",
        files: [],
        deleteFiles: ["../README.md"],
      }),
    ).ok,
    false,
  );
  check(
    true,
    "Recognize follow-up code edits, merge safe patches, and preserve untouched project files",
  );
  assert.equal(
    parseToolArguments(
      "create_project",
      JSON.stringify({
        name: "没有运行说明",
        description: "README 不能只有项目介绍",
        files: [
          { path: "index.html", content: "<!doctype html><title>demo</title>" },
          { path: "README.md", content: "一个用于展示活动信息的网页项目，包含清晰的内容层次。" },
        ],
      }),
    ).ok,
    false,
  );
  assert.equal(
    parseToolArguments(
      "create_project",
      JSON.stringify({
        name: "缺少说明",
        description: "非空 README 是交付要求",
        files: [
          { path: "index.html", content: "<!doctype html><title>demo</title>" },
          { path: "README.md", content: "   " },
        ],
      }),
    ).ok,
    false,
  );
  assert.equal(
    parseToolArguments(
      "create_project",
      JSON.stringify({
        name: "只有配置",
        description: "package.json 不能单独算作可运行入口",
        files: [
          { path: "package.json", content: '{"scripts":{"dev":"next dev"}}' },
          { path: "README.md", content: "运行 npm run dev" },
        ],
      }),
    ).ok,
    false,
  );
  assert.equal(
    parseToolArguments(
      "create_project",
      JSON.stringify({
        name: "React 工作台",
        description: "含启动命令和源码的前端项目",
        files: [
          { path: "package.json", content: '{"scripts":{"dev":"next dev"}}' },
          {
            path: "src/app/page.tsx",
            content: "export default function Page() { return <main /> }",
          },
          { path: "README.md", content: "运行 npm run dev" },
        ],
      }),
    ).ok,
    true,
  );
  assert.equal(
    parseToolArguments(
      "create_project",
      JSON.stringify({
        name: "Python 工具",
        description: "标准库脚本无需依赖配置也可运行",
        files: [
          { path: "main.py", content: 'print("hello")' },
          { path: "README.md", content: "运行 python main.py" },
        ],
      }),
    ).ok,
    true,
  );
  assert.equal(
    parseToolArguments(
      "generate_spreadsheet",
      JSON.stringify({
        title: "筹备清单",
        description: "可直接使用的表格",
        sheets: [{ name: "物资", columns: ["物品", "数量"], rows: [["签到卡", 20]] }],
      }),
    ).ok,
    true,
  );
  assert.equal(
    parseToolArguments(
      "generate_spreadsheet",
      JSON.stringify({
        title: "无效工作簿",
        description: "重复工作表名称应被拦截",
        sheets: [
          { name: "项目", columns: ["名称"], rows: [] },
          { name: "项目", columns: ["名称"], rows: [] },
        ],
      }),
    ).ok,
    false,
  );
  assert.equal(
    parseToolArguments(
      "generate_presentation",
      JSON.stringify({
        title: "演示稿",
        description: "两页演示内容",
        slides: [
          { title: "目标", bullets: ["确认目标"] },
          { title: "执行", bullets: ["推进任务"], speakerNotes: "介绍执行方式" },
        ],
      }),
    ).ok,
    true,
  );
  assert.equal(
    parseToolArguments(
      "generate_pdf",
      JSON.stringify({
        title: "活动执行方案",
        description: "可读中文的 PDF",
        content: "# 活动目标\n\n1. 确认任务与时间。",
      }),
    ).ok,
    true,
  );
  assert.equal(
    parseToolArguments(
      "generate_pdf",
      JSON.stringify({ title: "空文档", description: "", content: " " }),
    ).ok,
    false,
  );
  assert.equal(toolSchemas.create_tasks.safeParse({ tasks: [] }).success, false);
  assert.equal(
    toolSchemas.create_tasks.safeParse({
      tasks: [{ title: "发送邀请", detail: "名单确认", phase: "筹备" }],
    }).success,
    true,
  );
  check(true, "Validate all Agent tool inputs against shared Zod schemas before execution");
  const publicToolNames = agentToolCatalog.flatMap((category) => category.toolNames);
  assert.equal(publicToolNames.length, new Set(publicToolNames).size);
  assert.deepEqual([...publicToolNames].sort(), Object.keys(toolSchemas).sort());
  check(true, "Keep the user-facing tool catalog aligned with the Agent's executable tools");

  assert.equal(normalizeTimeRange("9:00 - 10:30"), "09:00–10:30");
  assert.equal(normalizeTimeRange("09:15 至 10:30"), "09:15–10:30");
  assert.equal(normalizeTimeRange("23:00-23:59"), "23:00–23:59");
  assert.equal(normalizeTimeRange("24:00-25:00"), null);
  assert.equal(normalizeTimeRange("10:00–09:00"), null);
  assert.equal(normalizeTimeRange("09:00"), null);
  assert.equal(normalizeTimeRange("下午三点"), null);
  assert.equal(timeRangesOverlap("09:00-10:00", "09:30–10:30"), true);
  assert.equal(timeRangesOverlap("09:00-10:00", "10:00至11:00"), false);
  assert.equal(normalizeScheduleDay("第 1 天"), normalizeScheduleDay("第1天"));
  assert.equal(
    requiresExecutionFeasibilityCheck("策划冬日活动：20 名参与者、5 名志愿者、4 个站点同时开放"),
    true,
    "an event with explicit attendance, staffing, and parallel stations must require a server-side feasibility review",
  );
  assert.equal(
    requiresExecutionFeasibilityCheck("策划一场冬日活动，时长 75 分钟"),
    false,
    "duration alone is not staffing, venue, or inventory evidence",
  );
  assert.equal(
    requiresExecutionFeasibilityCheck("策划冬日活动，之后再招募志愿者"),
    false,
    "an unquantified staffing mention alone must not add a pointless review step",
  );
  assert.equal(
    requiresExecutionFeasibilityCheck("策划校园活动，预计一百名学生到场"),
    true,
    "Chinese hundreds and explicit student attendance must trigger feasibility review",
  );
  assert.equal(
    requiresExecutionFeasibilityCheck("策划校园活动，预计一百多名学生到场"),
    true,
    "approximate Chinese attendee counts must trigger feasibility review",
  );
  assert.equal(
    requiresExecutionFeasibilityCheck("策划校园活动，预计来 20 个人"),
    true,
    "colloquial counted-person phrasing must trigger feasibility review",
  );
  assert.equal(
    requiresExecutionFeasibilityCheck("策划校园活动，预计 100 多个人参加"),
    true,
    "spaced Arabic approximate counts must trigger feasibility review",
  );
  assert.equal(
    requiresExecutionFeasibilityCheck("策划校园活动，预计数十名嘉宾到场"),
    true,
    "approximate tens of guests must trigger feasibility review",
  );
  assert.equal(
    requiresExecutionFeasibilityCheck("策划校园活动，邀请多名学生参与"),
    false,
    "unquantified attendee mentions must not add a pointless review step",
  );
  assert.equal(
    requiresExecutionFeasibilityCheck("开发一个 4 页面 Web 项目，包含 3 个按钮"),
    false,
    "ordinary software UI counts must not trigger event feasibility checks",
  );
  const savedEventFacts = "冬日活动：20 名参与者、5 名志愿者、4 个站点，每站 20 张卡片";
  assert.equal(
    shouldReviewExistingExecutionFeasibility("细化活动物料清单", savedEventFacts),
    true,
    "a continuation that revises an event plan must recheck its saved operational facts",
  );
  assert.equal(
    shouldReviewExistingExecutionFeasibility("到哪里了？", savedEventFacts),
    false,
    "a pure progress question must not trigger another feasibility review",
  );
  assert.equal(
    shouldReviewExistingExecutionFeasibility(
      "修改 Web 项目的按钮样式",
      "Web 项目含 4 页面和 3 个按钮",
    ),
    false,
    "an unrelated software edit must not trigger an event feasibility review",
  );
  const feasibilityEventsBeforeReview = [
    { name: "draft_document" },
    { name: "validate_feasibility" },
  ];
  const reviewIndex = feasibilityEventsBeforeReview.length - 1;
  assert.equal(
    nextExecutionFeasibilityTool({
      required: true,
      review: { valid: true, eventIndex: reviewIndex },
      latestDocumentIndex: latestDraftDocumentEventIndex(feasibilityEventsBeforeReview),
    }),
    null,
    "a valid review after the latest document revision completes the feasibility gate",
  );
  assert.equal(
    nextExecutionFeasibilityTool({
      required: true,
      review: { valid: true, eventIndex: 0 },
      latestDocumentIndex: 1,
    }),
    "validate_feasibility",
    "a later document revision invalidates an earlier feasibility review",
  );
  assert.equal(
    nextExecutionFeasibilityTool({
      required: true,
      review: { valid: false, eventIndex: reviewIndex },
      latestDocumentIndex: latestDraftDocumentEventIndex(feasibilityEventsBeforeReview),
    }),
    "draft_document",
    "a conflict requires document repair before another review",
  );
  assert.equal(
    nextExecutionFeasibilityTool({ required: true, review: null, latestDocumentIndex: -1 }),
    "validate_feasibility",
    "a required feasibility gate cannot be skipped when no review exists",
  );
  assert.equal(
    nextExecutionFeasibilityTool({ required: false, review: null, latestDocumentIndex: -1 }),
    null,
    "the feasibility gate remains dormant for unrelated goals",
  );
  const feasibleBlocks = [
    {
      date: "第 1 天",
      time: "18:00-18:20",
      activity: "健康知识站",
      venue: "活动室左区",
      attendeeCount: 8,
      unlistedOnsiteCount: 0,
      venueCapacity: 10,
      staff: [{ name: "小林", role: "讲解" }],
      resources: [{ name: "题卡", required: 5, available: 10 }],
    },
    {
      date: "第1天",
      time: "18:05-18:25",
      activity: "暖身互动站",
      venue: "活动室右区",
      attendeeCount: 9,
      unlistedOnsiteCount: 0,
      venueCapacity: 12,
      staff: [{ name: "小周", role: "主持" }],
      resources: [{ name: "题卡", required: 5, available: 10 }],
    },
  ];
  const completeFeasibility = validateExecutionFeasibility({ blocks: feasibleBlocks });
  assert.equal(completeFeasibility.valid, true);
  assert.equal(completeFeasibility.coverage.complete, true);
  assert.deepEqual(completeFeasibility.coverage.pending, []);
  assert.equal(completeFeasibility.checked.venueCapacityChecks, 2);
  const volunteerCapacityConflict = validateExecutionFeasibility({
    blocks: [
      {
        date: "活动当天",
        time: "09:00-10:00",
        activity: "冬日健康闯关",
        attendeeCount: 20,
        venueCapacity: 24,
        staff: Array.from({ length: 5 }, (_, index) => ({
          name: `志愿者${index + 1}`,
          role: "活动引导",
        })),
      },
    ],
  });
  assert.equal(volunteerCapacityConflict.valid, false);
  assert.match(
    volunteerCapacityConflict.issues[0]?.message || "",
    /参与者 20 人、现场支持人员 5 人，共 25 人，超过场地容量 24 人/,
  );
  assert.equal(
    validateExecutionFeasibility({
      blocks: [
        {
          date: "活动当天",
          time: "09:00-10:00",
          activity: "冬日健康闯关",
          attendeeCount: 20,
          unlistedOnsiteCount: 2,
          venueCapacity: 26,
          staff: Array.from({ length: 4 }, (_, index) => ({
            name: `志愿者${index + 1}`,
            role: "活动引导",
          })),
        },
      ],
    }).valid,
    true,
    "venue capacity must count participants, assigned staff, and other explicitly listed onsite people",
  );
  assert.equal(
    validateExecutionFeasibility({
      blocks: [
        {
          date: "活动当天",
          time: "09:00-10:00",
          activity: "冬日健康闯关",
          attendeeCount: 20,
          venueCapacity: 25,
          staff: Array.from({ length: 5 }, (_, index) => ({
            name: `志愿者${index + 1}`,
            role: "活动引导",
          })),
        },
      ],
    }).valid,
    true,
    "a venue with enough capacity for participants plus all assigned volunteers must pass",
  );
  const infeasible = validateExecutionFeasibility({
    blocks: feasibleBlocks.map((block, index) => ({
      ...block,
      venue: "同一活动室",
      attendeeCount: index === 0 ? 11 : block.attendeeCount,
      staff: [{ name: "小林", role: index === 0 ? "讲解" : "签到" }],
      resources: [{ name: "题卡", required: 6, available: 10 }],
    })),
  });
  assert.equal(infeasible.valid, false);
  assert.deepEqual(
    new Set(infeasible.issues.map((issue) => issue.type)),
    new Set(["venue_capacity", "staff_overlap", "venue_overlap", "resource_capacity"]),
  );
  const invalidFeasibility = validateExecutionFeasibility({
    blocks: [{ date: "第 1 天", time: "下午", activity: "晚会" }],
  });
  assert.equal(invalidFeasibility.issues[0]?.type, "invalid_block");
  assert.equal(invalidFeasibility.coverage.complete, false);
  assert.deepEqual(invalidFeasibility.coverage.pending[0]?.checks, ["有效日期、时段或活动名称"]);
  assert.equal(
    validateExecutionFeasibility({
      blocks: [
        {
          date: "第 1 天",
          time: "09:00-10:00",
          activity: "签到",
          staff: [
            { name: "小林", role: "签到" },
            { name: " 小林 ", role: "引导" },
          ],
        },
      ],
    }).issues[0]?.type,
    "duplicate_role",
  );
  const incompleteFeasibility = validateExecutionFeasibility({
    blocks: [{ date: "第 1 天", time: "09:00-10:00", activity: "签到" }],
  });
  assert.equal(
    incompleteFeasibility.valid,
    true,
    "unknown people, capacity, and inventory data must not be guessed",
  );
  assert.equal(incompleteFeasibility.coverage.complete, false);
  assert.deepEqual(incompleteFeasibility.coverage.pending[0]?.checks, [
    "场地名称",
    "参与者人数",
    "其他现场人员人数",
    "场地容量",
    "岗位名单",
    "物料清单",
  ]);
  assert.match(incompleteFeasibility.summary, /尚未完成完整核验/);
  assert.deepEqual(
    findScheduleConflict(
      [{ day: "第 1 天", time: "09:00-10:00" }],
      [
        { day: "第1天", time: "10:00-11:00" },
        { day: "第 1 天", time: "10:30-11:30" },
      ],
    ),
    { day: "第 1 天", time: "10:30-11:30" },
  );
  assert.equal(
    findScheduleConflict(
      [{ day: "第 1 天", time: "09:00-10:00" }],
      [{ day: "第 2 天", time: "09:30-10:30" }],
    ),
    null,
  );
  check(
    true,
    "Validate schedule ranges, overlaps, staff assignments, venue capacity, and shared resources",
  );

  const calendarMilestones = [
    {
      label: "签到,暖场",
      date: "活动当天 · 09:00-09:20",
      note: "地点：报告厅;签到,准备\n请预留入场时间",
    },
    { label: "主题分享", date: "第 1 天 · 09:20–10:30", note: "按现场节奏调整" },
    { label: "返程整理", date: "第十天 · 14:00-15:00", note: "" },
  ];
  assert.deepEqual(inspectCalendarSchedule(calendarMilestones), {
    eventCount: 3,
    requiresAnchor: true,
    issues: [],
  });
  assert.equal(createCalendarExport(calendarMilestones).code, "anchor-required");
  const calendar = createCalendarExport(
    calendarMilestones,
    "2026-11-10",
    new Date("2026-11-01T12:34:56.789Z"),
  );
  assert.equal(calendar.ok, true);
  assert.equal(calendar.eventCount, 3);
  assert.match(calendar.content, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(calendar.content, /DTSTAMP:20261101T123456Z/);
  assert.match(calendar.content, /DTSTART:20261110T010000Z\r\nDTEND:20261110T012000Z/);
  assert.match(calendar.content, /DTSTART:20261119T060000Z/);
  assert.match(calendar.content, /SUMMARY:签到\\,暖场/);
  assert.match(calendar.content, /LOCATION:报告厅/);
  assert.match(calendar.content, /DESCRIPTION:.*\\;.*\\,.*\\n/);
  assert.equal(/(^|[^\r])\n/.test(calendar.content), false);
  assert.ok(
    calendar.content
      .split("\r\n")
      .filter(Boolean)
      .every((line) => Buffer.byteLength(line, "utf8") <= 75),
  );
  const explicitCalendar = createCalendarExport(
    [{ label: "复盘会议", date: "2026-12-01 · 09:00-09:30", note: "" }],
    "",
    new Date("2026-11-01T00:00:00.000Z"),
  );
  assert.equal(explicitCalendar.ok, true);
  assert.equal(
    createCalendarExport([{ label: "未知", date: "某个工作日 · 09:00-10:00", note: "" }]).code,
    "unsupported-date",
  );
  assert.equal(
    createCalendarExport([{ label: "无效日期", date: "2026-02-30 · 09:00-10:00", note: "" }]).code,
    "invalid-date",
  );
  assert.equal(
    createCalendarExport(
      [{ label: "无效时间", date: "活动当天 · 24:00-25:00", note: "" }],
      "2026-11-10",
    ).code,
    "invalid-time",
  );
  check(
    true,
    "Export relative or explicit schedules as RFC 5545 calendars without inventing dates",
  );

  const normalizedBudget = normalizeBudgetItems([
    { name: "  场地  ", amount: 320.555 },
    { name: "物料", amount: 179.45 },
  ]);
  assert.deepEqual(normalizedBudget, {
    items: [
      { name: "场地", amount: 320.56 },
      { name: "物料", amount: 179.45 },
    ],
    total: 500.01,
  });
  assert.match(normalizeBudgetItems([]).error, /不能为空/);
  assert.match(normalizeBudgetItems([{ name: "场地", amount: Infinity }]).error, /格式无效/);
  assert.match(
    normalizeBudgetItems([{ name: "异常大额", amount: BUDGET_AMOUNT_LIMIT + 1 }]).error,
    /不能超过/,
  );
  assert.match(
    normalizeBudgetItems([
      { name: "预算 A", amount: BUDGET_AMOUNT_LIMIT },
      { name: "预算 B", amount: 1 },
    ]).error,
    /合计超出/,
  );
  assert.match(
    normalizeBudgetItems(
      Array.from({ length: 16 }, (_, index) => ({ name: `预算 ${index}`, amount: 1 })),
    ).error,
    /最多包含 15 项/,
  );
  check(
    true,
    "Validate budget items, round currency, and reject empty, malformed, excessive, or overflowing totals",
  );

  const maximumTasks = Array.from({ length: 60 }, (_, index) => `task-${index + 1}`);
  const maximumMilestones = Array.from({ length: 100 }, (_, index) => `milestone-${index + 1}`);
  assert.equal(keepWithinLimit(maximumTasks, 60).length, 60);
  assert.equal(keepWithinLimit(maximumTasks, 60).at(-1), "task-60");
  assert.equal(keepWithinLimit(maximumMilestones, 100).at(-1), "milestone-100");
  assert.equal(availableCapacity(60, 60, 10), 0);
  assert.equal(availableCapacity(58, 60, 10), 2);
  assert.equal(availableCapacity(98, 100, 8), 2);
  check(true, "Preserve maximum-size task and timeline state while bounding new tool output");

  const priorExecution = {
    summary: "前一个执行结果",
    projectDraft: {
      mode: "full",
      title: "待续写项目",
      description: "分批代码",
      files: [{ path: "README.md", content: "启动说明" }],
    },
    tasks: [],
    milestones: [{ label: "阶段", date: "待定", note: "保留原节点" }],
    artifacts: [
      { id: "old-document", type: "document", title: "旧方案", description: "旧", content: "旧" },
      {
        id: "old-code",
        type: "code",
        title: "代码",
        description: "代码项目",
        content: "",
        files: [],
      },
    ],
    events: [
      { id: "event-1", name: "create_tasks", title: "任务", detail: "完成", status: "done" },
    ],
  };
  const checkpoint = mergeExecutionCheckpoint(
    priorExecution,
    {
      summary: "当前步骤",
      tasks: [{ id: "task-1", title: "新任务", detail: "", phase: "执行", status: "pending" }],
      milestones: [],
      artifacts: [
        { id: "new-document", type: "document", title: "新方案", description: "新", content: "新" },
      ],
      events: [
        priorExecution.events[0],
        { id: "event-2", name: "draft_document", title: "方案", detail: "已起草", status: "done" },
      ],
    },
    "执行中：阶段成果已保存",
  );
  assert.equal(checkpoint.summary, "执行中：阶段成果已保存");
  assert.deepEqual(checkpoint.projectDraft, priorExecution.projectDraft);
  assert.deepEqual(
    checkpoint.tasks.map(({ id }) => id),
    ["task-1"],
  );
  assert.deepEqual(checkpoint.milestones, priorExecution.milestones);
  assert.deepEqual(
    checkpoint.artifacts.map(({ id }) => id),
    ["old-code", "new-document"],
  );
  assert.deepEqual(
    checkpoint.events.map(({ id }) => id),
    ["event-1", "event-2"],
  );
  const completedProjectCheckpoint = mergeExecutionCheckpoint(
    checkpoint,
    { ...checkpoint, projectDraft: null },
    "项目已完整交付",
  );
  assert.equal(completedProjectCheckpoint.projectDraft, null);
  check(
    true,
    "Checkpoint tool results without duplicating events or dropping earlier artifacts and milestones",
  );

  assert.deepEqual(
    missingInitialAgentOutputs({
      isContinuation: false,
      needsBudget: true,
      taskCount: 0,
      milestoneCount: 0,
      hasDocument: false,
      hasBudget: false,
    }),
    ["任务", "时间线", "行动方案", "预算核算"],
  );
  assert.deepEqual(
    missingInitialAgentOutputs({
      isContinuation: false,
      needsBudget: false,
      taskCount: 2,
      milestoneCount: 2,
      hasDocument: true,
      hasBudget: false,
      needsProject: true,
      hasProject: false,
    }),
    ["可运行代码项目"],
  );
  assert.deepEqual(
    missingInitialAgentOutputs({
      isContinuation: false,
      needsBudget: true,
      taskCount: 3,
      milestoneCount: 2,
      hasDocument: true,
      hasBudget: false,
    }),
    ["预算核算"],
  );
  assert.deepEqual(
    missingInitialAgentOutputs({
      isContinuation: true,
      needsBudget: true,
      taskCount: 0,
      milestoneCount: 0,
      hasDocument: false,
      hasBudget: false,
    }),
    [],
  );
  assert.deepEqual(
    missingInitialAgentOutputs({
      isContinuation: false,
      needsBudget: false,
      taskCount: 2,
      milestoneCount: 2,
      hasDocument: true,
      hasBudget: false,
      needsPdf: true,
      hasPdf: false,
    }),
    ["PDF 文件"],
  );
  check(true, "Reject incomplete initial Agent output without blocking follow-up instructions");

  const health = await request("/");
  assert.equal(health.response.status, 200, "NEXORA home page must be available");
  assert.equal(health.response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(health.response.headers.get("x-frame-options"), "DENY");
  assert.equal(health.response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(health.response.headers.get("permissions-policy") || "", /camera=\(\)/);
  check(true, "Apply baseline browser security headers to application responses");

  const overlongRegistrationName = await request("/api/auth/register", {
    method: "POST",
    body: {
      name: "N".repeat(49),
      email: `nexora-long-name-${crypto.randomUUID()}@example.test`,
      password,
    },
  });
  const overlongRegistrationEmail = await request("/api/auth/register", {
    method: "POST",
    body: {
      name: "NEXORA Smoke",
      email: `a@b.c${"x".repeat(251)}`,
      password,
    },
  });
  assert.equal(overlongRegistrationName.response.status, 400);
  assert.equal(overlongRegistrationEmail.response.status, 400);
  check(true, "Reject overlong registration identity fields without silently truncating them");

  const registration = await request("/api/auth/register", {
    method: "POST",
    body: { name: "NEXORA Smoke", email, password },
  });
  assert.equal(registration.response.status, 200, "temporary user registration must succeed");
  testUserId = registration.payload?.user?.id;
  assert.ok(testUserId, "registration must return a user ID");
  recoveryCode = registration.payload?.recoveryCode;
  assert.match(recoveryCode || "", /^[A-Za-z0-9_-]{40,}$/);
  assert.equal("recovery_code_hash" in registration.payload.user, false);
  assert.equal(registration.payload.user.recoveryCodeConfigured, true);
  testUserIds.push(testUserId);
  const setCookie =
    registration.response.headers.getSetCookie?.()[0] ||
    registration.response.headers.get("set-cookie");
  sessionCookie = setCookie?.split(";")[0];
  assert.ok(sessionCookie, "registration must establish an HTTP-only session cookie");
  check(true, "Register, establish a session, and issue a private recovery code");

  const presentationExport = await fetch(new URL("/api/artifacts/presentation", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: sessionCookie,
      "X-Forwarded-For": smokeClientAddress,
    },
    body: JSON.stringify({
      title: "演示导出自检",
      description: "检查服务端生成的可编辑演示文稿",
      content: JSON.stringify({
        slides: [
          { title: "目标与背景", bullets: ["清楚描述目标"], speakerNotes: "先介绍项目背景。" },
          { title: "执行方案", bullets: ["拆分任务", "展示结果"] },
        ],
      }),
    }),
  });
  assert.equal(presentationExport.status, 200, "PowerPoint export must return a file");
  assert.match(
    presentationExport.headers.get("content-type") || "",
    /application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation/i,
  );
  const pptxArchive = await JSZip.loadAsync(await presentationExport.arrayBuffer());
  assert.ok(pptxArchive.file("ppt/presentation.xml"));
  assert.ok(pptxArchive.file("ppt/slides/slide1.xml"));
  assert.ok(pptxArchive.file("ppt/slides/slide2.xml"));
  assert.ok(pptxArchive.file("ppt/notesSlides/notesSlide1.xml"));
  const exportedSlide = await pptxArchive.file("ppt/slides/slide1.xml").async("string");
  assert.match(exportedSlide, /目标与背景/);
  check(true, "Export a valid PowerPoint package with slides and speaker notes");

  const pdfContent = `# 活动目标\n\n**目标：** 生成中文可读、自动分页的行动方案。\n\n| 阶段 | 任务 |\n| --- | --- |\n| 准备 | 确认场地与分工 |\n| 执行 | 记录现场反馈 |\n\n1. 确认负责人。\n2. 完成执行与复盘。\n\n> 活动当天按现场确认后的时间安排执行。\n\n${"冬日健康守护活动需要明确时间、分工与风险预案。".repeat(80)}`;
  const pdfExport = await fetch(new URL("/api/artifacts/pdf", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: sessionCookie,
      "X-Forwarded-For": smokeClientAddress,
    },
    body: JSON.stringify({
      title: "冬日活动执行方案",
      description: "中文 PDF 导出与分页自检",
      content: pdfContent,
    }),
  });
  assert.equal(pdfExport.status, 200, "PDF export must return a file");
  assert.match(pdfExport.headers.get("content-type") || "", /application\/pdf/i);
  assert.match(pdfExport.headers.get("content-disposition") || "", /filename\*=UTF-8''/i);
  const generatedPdf = Buffer.from(await pdfExport.arrayBuffer());
  assert.equal(generatedPdf.subarray(0, 5).toString("ascii"), "%PDF-");
  const pdfDocument = await pdfjs.getDocument({
    data: new Uint8Array(generatedPdf),
    standardFontDataUrl: `${process.cwd()}/public/pdfjs-standard-fonts/`,
    useSystemFonts: false,
  }).promise;
  assert.ok(pdfDocument.numPages >= 2, "long PDF content must paginate into multiple pages");
  const finalPdfPage = await pdfDocument.getPage(pdfDocument.numPages);
  const finalPdfPageText = (await finalPdfPage.getTextContent()).items
    .map((item) => item.str)
    .join("")
    .replace(/\s+/g, "");
  assert.match(finalPdfPageText, new RegExp(`${pdfDocument.numPages}/${pdfDocument.numPages}`));
  const pdfText = await readChatDocument(
    new File([generatedPdf], "冬日活动执行方案.pdf", { type: "application/pdf" }),
  );
  const normalizedPdfText = pdfText.replace(/\s+/g, "");
  assert.match(normalizedPdfText, /冬日活动执行方案/);
  assert.match(normalizedPdfText, /活动目标/);
  assert.match(normalizedPdfText, /确认场地与分工/);
  check(
    true,
    "Export and parse a multi-page Chinese PDF with embedded fonts, headings, tables, lists, and page numbers",
  );

  const longPassword = "🔐".repeat(40);
  const longPasswordDigest = crypto.createHash("sha256").update(longPassword, "utf8").digest("hex");
  const previousVersionHash = `v2$${await bcrypt.hash(`nexora-password-v2:${longPasswordDigest}`, 12)}`;
  assert.equal(await verifyPassword(longPassword, previousVersionHash), true);
  assert.equal(needsPasswordUpgrade(previousVersionHash), true);
  const newVersionHash = await hashPassword(longPassword);
  assert.equal(newVersionHash.startsWith("v3$"), true);
  assert.equal(await verifyPassword(longPassword, newVersionHash), true);
  assert.equal(await verifyPassword("🔐".repeat(18) + "🔑".repeat(22), newVersionHash), false);
  const longPasswordEmail = `nexora-long-password-${crypto.randomUUID()}@example.test`;
  const longPasswordRegistration = await request("/api/auth/register", {
    method: "POST",
    body: { name: "NEXORA Password Test", email: longPasswordEmail, password: longPassword },
  });
  assert.equal(longPasswordRegistration.response.status, 200);
  const longPasswordUserId = longPasswordRegistration.payload.user.id;
  testUserIds.push(longPasswordUserId);
  database ||= new Database(resolveDatabasePath(), {
    timeout: 10_000,
  });
  const legacyHash = await bcrypt.hash(longPassword, 12);
  database
    .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .run(legacyHash, longPasswordUserId);
  const legacyLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email: longPasswordEmail, password: longPassword },
  });
  assert.equal(legacyLogin.response.status, 200);
  const upgradedHash = database
    .prepare("SELECT password_hash FROM users WHERE id = ?")
    .get(longPasswordUserId).password_hash;
  assert.equal(needsPasswordUpgrade(upgradedHash), false);
  const samePrefixDifferentSuffix = "🔐".repeat(18) + "🔑".repeat(22);
  const rejectedPasswordVariant = await request("/api/auth/login", {
    method: "POST",
    body: { email: longPasswordEmail, password: samePrefixDifferentSuffix },
  });
  assert.equal(
    rejectedPasswordVariant.response.status,
    401,
    "a different multibyte password suffix must not match after upgrade",
  );
  check(
    true,
    "Migrate legacy password hashes and preserve multibyte password suffixes beyond bcrypt's byte limit",
  );

  const concurrentRegistrations = await Promise.all(
    Array.from({ length: 2 }, () =>
      request("/api/auth/register", {
        method: "POST",
        body: { name: "NEXORA Race", email: concurrentEmail, password },
      }),
    ),
  );
  assert.deepEqual(
    concurrentRegistrations.map(({ response }) => response.status).sort(),
    [200, 409],
    "concurrent registrations for one email must create exactly one account",
  );
  const concurrentUser = concurrentRegistrations.find(({ response }) => response.status === 200)
    ?.payload?.user;
  assert.ok(concurrentUser?.id);
  testUserIds.push(concurrentUser.id);
  check(true, "Serialize concurrent account creation and return a clear duplicate-email conflict");

  const identity = await request("/api/auth/me", { cookie: sessionCookie });
  assert.equal(identity.response.status, 200);
  assert.equal(identity.payload?.user?.id, testUserId);

  const crossOriginProfile = await request("/api/auth/profile", {
    method: "PATCH",
    cookie: sessionCookie,
    headers: { Origin: "https://attacker.example" },
    body: { name: "Cross-origin change" },
  });
  assert.equal(crossOriginProfile.response.status, 400);
  const formEncodedProfile = await request("/api/auth/profile", {
    method: "PATCH",
    cookie: sessionCookie,
    headers: { "Content-Type": "text/plain" },
    body: { name: "Form-encoded change" },
  });
  assert.equal(formEncodedProfile.response.status, 400);
  const unchangedIdentity = await request("/api/auth/me", { cookie: sessionCookie });
  assert.equal(unchangedIdentity.payload?.user?.name, "NEXORA Smoke");
  check(true, "Reject cross-origin and non-JSON profile mutations");

  const invalidProfile = await request("/api/auth/profile", {
    method: "PATCH",
    cookie: sessionCookie,
    body: { name: "x" },
  });
  assert.equal(invalidProfile.response.status, 400);
  const profileUpdate = await request("/api/auth/profile", {
    method: "PATCH",
    cookie: sessionCookie,
    body: { name: "NEXORA Smoke Updated" },
  });
  assert.equal(profileUpdate.response.status, 200);
  assert.equal(profileUpdate.payload?.user?.name, "NEXORA Smoke Updated");
  assert.equal("password_hash" in profileUpdate.payload.user, false);
  const updatedIdentity = await request("/api/auth/me", { cookie: sessionCookie });
  assert.equal(updatedIdentity.payload?.user?.name, "NEXORA Smoke Updated");
  check(true, "Update the signed-in user's display name without exposing private account fields");

  const knowledge = await request("/api/knowledge", {
    method: "POST",
    cookie: sessionCookie,
    body: {
      title: "Smoke test context",
      content: "学院阶梯教室配有固定投影和扩音设备，适合组织本科生参加的学术报告与技术工作坊。",
    },
  });
  assert.equal(knowledge.response.status, 201, "knowledge document save must succeed");
  const documents = await request("/api/knowledge", { cookie: sessionCookie });
  assert.equal(documents.response.status, 200);
  assert.ok(
    documents.payload?.documents?.some((item) => item.id === knowledge.payload?.document?.id),
  );
  const knowledgeUpdate = await request(`/api/knowledge/${knowledge.payload.document.id}`, {
    method: "PUT",
    cookie: sessionCookie,
    body: {
      title: "Updated smoke context",
      content:
        "学院阶梯教室配有固定投影和扩音设备，适合组织本科生参加的学术报告与技术工作坊；场地预留无障碍座位。",
    },
  });
  assert.equal(knowledgeUpdate.response.status, 200);
  assert.equal(knowledgeUpdate.payload?.document?.title, "Updated smoke context");
  assert.match(knowledgeUpdate.payload?.document?.content || "", /无障碍座位/);
  const updatedKnowledgeDocument = knowledgeUpdate.payload.document;
  const oldEmbeddingHash = crypto
    .createHash("sha256")
    .update(`${updatedKnowledgeDocument.title}\n${updatedKnowledgeDocument.content}`)
    .digest("hex");
  database
    .prepare(
      `INSERT INTO knowledge_embeddings
        (knowledge_id, user_id, chunk_index, content_hash, excerpt, vector_json, updated_at)
       VALUES (?, ?, 0, ?, ?, ?, ?)`,
    )
    .run(
      updatedKnowledgeDocument.id,
      testUserId,
      oldEmbeddingHash,
      updatedKnowledgeDocument.content,
      JSON.stringify(Array(512).fill(0)),
      new Date().toISOString(),
    );
  check(true, "Save, retrieve, and update private knowledge context");

  const spoofedImage = await request("/api/plan", {
    method: "POST",
    cookie: sessionCookie,
    body: {
      prompt: "请分析这张活动图片并规划后续工作。",
      image: "data:image/png;base64,dGVzdA==",
      demo: true,
    },
  });
  assert.equal(spoofedImage.response.status, 400);
  assert.match(spoofedImage.payload?.error || "", /图片仅支持/);
  check(true, "Reject image payloads whose content signature does not match the declared type");

  const unsafePlanningAttachment = await request("/api/plan", {
    method: "POST",
    cookie: sessionCookie,
    body: {
      prompt: "根据活动资料制定一次活动计划。",
      attachments: [
        {
          name: "../private.txt",
          mimeType: "text/plain",
          kind: "text",
          content: "不可接受的路径文件名。",
        },
      ],
      demo: true,
    },
  });
  assert.equal(unsafePlanningAttachment.response.status, 400);
  assert.match(unsafePlanningAttachment.payload?.error || "", /名称或内容无效/);
  const demoPlanningAttachment = await request("/api/plan", {
    method: "POST",
    cookie: sessionCookie,
    body: {
      prompt: "根据活动资料制定一次活动计划。",
      attachments: [
        {
          name: "活动约束.md",
          mimeType: "text/markdown",
          kind: "text",
          content: "室内场地，预算 3000 元。",
        },
      ],
      demo: true,
    },
  });
  assert.equal(demoPlanningAttachment.response.status, 400);
  assert.match(demoPlanningAttachment.payload?.error || "", /演示模式不会读取图片或资料/);
  check(true, "Validate initial planning documents and keep them out of demo-mode requests");

  const prompt =
    "我想给大学生做一场关于人工智能行业的线下介绍，需要有投影的场地；预计 40 人，预算控制在 800 元以内，并安排一份 3 小时的现场议程。";
  const aiUsageBeforeCrossOriginRequests = database
    .prepare("SELECT COUNT(*) AS requests FROM ai_usage WHERE user_id = ?")
    .get(testUserId).requests;
  const crossOriginPlan = await request("/api/plan", {
    method: "POST",
    cookie: sessionCookie,
    headers: { Origin: "https://attacker.example" },
    body: { prompt, demo: false },
  });
  const crossOriginExecution = await request("/api/execute", {
    method: "POST",
    cookie: sessionCookie,
    headers: { Origin: "https://attacker.example" },
    body: { goal: prompt },
  });
  assert.equal(crossOriginPlan.response.status, 400);
  assert.equal(crossOriginExecution.response.status, 400);
  assert.equal(
    database.prepare("SELECT COUNT(*) AS requests FROM ai_usage WHERE user_id = ?").get(testUserId)
      .requests,
    aiUsageBeforeCrossOriginRequests,
  );
  check(true, "Reject cross-origin planning and execution before they can spend AI usage");

  const plannedWorkspaceId = liveMode ? crypto.randomUUID() : undefined;
  const planned = await request("/api/plan", {
    method: "POST",
    cookie: sessionCookie,
    body: {
      prompt,
      demo: !liveMode,
      ...(plannedWorkspaceId ? { workspaceId: plannedWorkspaceId } : {}),
    },
    timeoutMs: 90_000,
  });
  assert.equal(
    planned.response.status,
    200,
    `planning must succeed: ${planned.payload?.error || ""}`,
  );
  assert.equal(planned.payload?.mode, liveMode ? "live" : "demo");
  assert.ok(planned.payload?.plan?.routes?.length >= 2);
  if (liveMode) {
    const usage = planned.payload.usage;
    assert.equal(usage?.model, "deepseek-flash");
    assert.ok(Number.isSafeInteger(usage?.inputTokens) && usage.inputTokens > 0);
    assert.ok(Number.isSafeInteger(usage?.outputTokens) && usage.outputTokens > 0);
    if (usage.cachedInputTokens !== undefined) {
      assert.ok(
        Number.isSafeInteger(usage.cachedInputTokens) &&
          usage.cachedInputTokens >= 0 &&
          usage.cachedInputTokens <= usage.inputTokens,
      );
    }
    assert.ok(usage.totalTokens >= usage.inputTokens + usage.outputTokens);
    assert.equal(usage.requests, 1);
    assert.ok(Number.isSafeInteger(usage.latencyMs) && usage.latencyMs > 0);
    assert.equal(planned.payload.persisted, true);
    assert.equal(planned.payload.workspace?.id, plannedWorkspaceId);
    assert.equal(planned.payload.workspace?.plan?.title, planned.payload.plan.title);
    const persistedPlan = await request(`/api/workspaces/${plannedWorkspaceId}`, {
      cookie: sessionCookie,
    });
    assert.equal(persistedPlan.response.status, 200);
    assert.equal(persistedPlan.payload?.workspace?.prompt, prompt);
    assert.equal(persistedPlan.payload?.workspace?.mode, "live");
    const usageBeforeReplay = database
      .prepare("SELECT COUNT(*) AS count FROM ai_usage WHERE user_id = ?")
      .get(testUserId).count;
    const replay = await request("/api/plan", {
      method: "POST",
      cookie: sessionCookie,
      body: { prompt, demo: false, workspaceId: plannedWorkspaceId },
    });
    assert.equal(replay.response.status, 200);
    assert.equal(replay.payload?.workspace?.id, plannedWorkspaceId);
    assert.deepEqual(replay.payload?.plan, planned.payload.plan);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM ai_usage WHERE user_id = ?").get(testUserId)
        .count,
      usageBeforeReplay,
      "replaying a saved plan must not consume provider tokens again",
    );
    livePlanWorkspaceIds.push(plannedWorkspaceId);
    check(true, "Persist live plans before responding and replay them without another model call");
  } else {
    assert.equal(planned.payload?.usage, undefined);
  }
  const planningKnowledgeSource = planned.payload?.plan?.sources?.find(
    (source) => source.id === knowledge.payload.document.id,
  );
  assert.ok(planningKnowledgeSource, "planning must include the matching private knowledge source");
  assert.match(
    planningKnowledgeSource.excerpt,
    /固定投影和扩音设备/,
    "a hybrid retrieval hit must keep the exact keyword-grounded source excerpt",
  );
  const expectedEmbeddingHash = crypto
    .createHash("sha256")
    .update(
      `${KNOWLEDGE_EMBEDDING_VERSION}\n${updatedKnowledgeDocument.title}\n${updatedKnowledgeDocument.content}`,
    )
    .digest("hex");
  const migratedEmbedding = database
    .prepare(
      "SELECT vector_json FROM knowledge_embeddings WHERE knowledge_id = ? AND content_hash = ?",
    )
    .get(updatedKnowledgeDocument.id, expectedEmbeddingHash);
  if (migratedEmbedding) {
    const vector = JSON.parse(migratedEmbedding.vector_json);
    assert.ok(Array.isArray(vector) && vector.length >= 32 && vector.every(Number.isFinite));
    assert.equal(
      planningKnowledgeSource.matchType,
      "hybrid",
      "the paraphrased event request must be grounded by both semantic and keyword retrieval",
    );
    check(
      true,
      "Rebuild stale prompt-based vectors and retrieve a paraphrased event source through the hybrid index",
    );
  } else {
    assert.equal(planningKnowledgeSource.matchType, "keyword");
    check(true, "Fall back to keyword knowledge retrieval when local model weights are absent");
  }
  check(true, `Generate a multi-route ${liveMode ? "live" : "demo"} plan with knowledge context`);

  if (!liveMode) {
    const intentCases = [
      {
        prompt: "这周要准备考试、完成课程作业，还想每天运动，请帮我安排时间。",
        category: "日程规划",
      },
      {
        prompt: "规划一次厦门三天旅行，安排交通、游览和每天的节奏。",
        category: "旅行规划",
      },
      {
        prompt: "我们三个人要在一周内完成一个 AI Web 项目，请拆解阶段和任务。",
        category: "项目推进",
      },
    ];
    for (const intent of intentCases) {
      const response = await request("/api/plan", {
        method: "POST",
        cookie: sessionCookie,
        body: { prompt: intent.prompt, demo: true },
      });
      assert.equal(response.response.status, 200);
      assert.equal(response.payload?.plan?.category, intent.category);
      assert.equal(response.payload?.plan?.routes?.length, 3);
      assert.ok(response.payload?.plan?.tasks?.length >= 4);
    }
    check(
      true,
      "Classify schedule, travel, and developer project goals without a feature selector",
    );
  }

  const plan = planned.payload.plan;
  let persistedExecutionWorkspace;
  let workspaceUsageAfterCancellation;
  if (liveMode) {
    const beforeMissingWorkspaceRequest = database
      .prepare("SELECT COUNT(*) AS count FROM ai_usage WHERE user_id = ?")
      .get(testUserId).count;
    const missingWorkspace = await request("/api/execute", {
      method: "POST",
      cookie: sessionCookie,
      body: {
        goal: prompt,
        plan,
        route: plan.routes[0],
        demo: false,
        currentTasks: [],
        currentMilestones: [],
      },
    });
    assert.equal(missingWorkspace.response.status, 409);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM ai_usage WHERE user_id = ?").get(testUserId)
        .count,
      beforeMissingWorkspaceRequest,
      "execution without its persisted workspace must be rejected before model usage",
    );
    check(true, "Require a saved workspace ID before live execution without spending model tokens");
  }

  const lockWorkspaceId = liveMode ? plannedWorkspaceId : crypto.randomUUID();
  const lockWorkspace = liveMode
    ? planned.payload.workspace
    : {
        id: lockWorkspaceId,
        prompt,
        plan,
        selectedRouteId: plan.routes[0].id,
        result: null,
        conversation: [],
        createdAt: new Date().toISOString(),
        mode: "demo",
      };
  if (!liveMode) {
    const savedLockWorkspace = await request("/api/workspaces", {
      method: "POST",
      cookie: sessionCookie,
      body: { workspace: lockWorkspace },
    });
    assert.equal(savedLockWorkspace.response.status, 200);
  }
  const executionLeaseToken = crypto.randomUUID();
  database
    .prepare(
      "INSERT INTO workspace_execution_locks (workspace_id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run(lockWorkspaceId, testUserId, executionLeaseToken, Date.now() + 10 * 60_000);
  try {
    const usageBeforeBusyExecution = database
      .prepare("SELECT COUNT(*) AS count FROM ai_usage WHERE user_id = ?")
      .get(testUserId).count;
    const busyExecution = await request("/api/execute", {
      method: "POST",
      cookie: sessionCookie,
      body: {
        workspaceId: lockWorkspaceId,
        goal: prompt,
        plan,
        route: plan.routes[0],
        demo: false,
        currentTasks: [],
        currentMilestones: [],
      },
    });
    assert.equal(busyExecution.response.status, 409);
    assert.match(busyExecution.payload?.error || "", /正在执行中/);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM ai_usage WHERE user_id = ?").get(testUserId)
        .count,
      usageBeforeBusyExecution,
      "a duplicate execution must be rejected before provider usage is recorded",
    );

    const blockedSave = await request("/api/workspaces", {
      method: "POST",
      cookie: sessionCookie,
      body: { workspace: lockWorkspace },
    });
    assert.equal(blockedSave.response.status, 409);
    assert.match(blockedSave.payload?.error || "", /正在由 Agent 执行/);
  } finally {
    database
      .prepare("DELETE FROM workspace_execution_locks WHERE workspace_id = ? AND token = ?")
      .run(lockWorkspaceId, executionLeaseToken);
    if (!liveMode)
      database
        .prepare("DELETE FROM workspaces WHERE id = ? AND user_id = ?")
        .run(lockWorkspaceId, testUserId);
  }
  check(true, "Reject duplicate live executions and workspace overwrites while a goal is running");

  const executed = await request("/api/execute", {
    method: "POST",
    cookie: sessionCookie,
    body: {
      ...(liveMode ? { workspaceId: plannedWorkspaceId } : {}),
      goal: prompt,
      plan,
      route: plan.routes[0],
      demo: !liveMode,
      currentTasks: [],
      currentMilestones: [],
    },
    timeoutMs: 210_000,
  });
  const executionTrace = executed.streamEvents.map((event) => ({
    type: event.type,
    ...(typeof event.message === "string" ? { message: event.message } : {}),
    ...(typeof event.title === "string" ? { title: event.title } : {}),
    ...(typeof event.error === "string" ? { error: event.error } : {}),
    ...(event.type === "text" && typeof event.text === "string"
      ? { text: event.text.slice(0, 240) }
      : {}),
  }));
  assert.equal(
    executed.response.status,
    200,
    `execution must succeed: ${executed.payload?.error || ""}; trace=${JSON.stringify(executionTrace)}`,
  );
  assert.equal(
    executed.payload?.mode,
    liveMode ? "live" : "demo",
    `execution response must include its mode: ${JSON.stringify(executed.payload)}; trace=${JSON.stringify(executionTrace)}`,
  );
  assert.ok(executed.payload?.result?.tasks?.length);
  assert.ok(executed.payload?.result?.milestones?.length);
  assert.ok(executed.payload?.result?.artifacts?.length);
  assert.ok(executed.payload?.result?.events?.length);
  if (liveMode) {
    assert.match(
      executed.response.headers.get("content-type") || "",
      /^text\/event-stream/i,
      "live execution must use a standard server-sent event stream",
    );
    assert.ok(
      executed.streamEvents.some((event) => event.type === "status") &&
        executed.streamEvents.some((event) => event.type === "tool") &&
        executed.streamEvents.some((event) => event.type === "result"),
      "live execution must stream Agent status, completed tool events, and the final workspace",
    );
    const usage = executed.payload.result.usage;
    assert.ok(usage?.model === "deepseek-flash");
    assert.ok(Number.isSafeInteger(usage.inputTokens) && usage.inputTokens > 0);
    assert.ok(Number.isSafeInteger(usage.outputTokens) && usage.outputTokens > 0);
    if (usage.cachedInputTokens !== undefined) {
      assert.ok(
        Number.isSafeInteger(usage.cachedInputTokens) &&
          usage.cachedInputTokens >= 0 &&
          usage.cachedInputTokens <= usage.inputTokens,
      );
    }
    assert.ok(usage.totalTokens >= usage.inputTokens + usage.outputTokens);
    assert.ok(Number.isSafeInteger(usage.latencyMs) && usage.latencyMs > 0);
    assert.ok(Number.isSafeInteger(usage.requests) && usage.requests >= 1 && usage.requests <= 9);
    const persistedExecution = await request(`/api/workspaces/${plannedWorkspaceId}`, {
      cookie: sessionCookie,
    });
    assert.equal(persistedExecution.response.status, 200);
    persistedExecutionWorkspace = persistedExecution.payload.workspace;
    assert.deepEqual(
      persistedExecution.payload.workspace.result.events,
      executed.payload.result.events,
    );
    assert.equal(
      persistedExecution.payload.workspace.usage.totalTokens,
      planned.payload.usage.totalTokens + usage.totalTokens,
    );
    check(true, "Persist live execution results and combined usage before closing the stream");
  } else {
    assert.equal(executed.payload.result.usage, undefined);
  }
  const toolNames = new Set(executed.payload.result.events.map((event) => event.name));
  for (const requiredTool of [
    "create_tasks",
    "build_timeline",
    "draft_document",
    "calculate_budget",
  ]) {
    assert.ok(toolNames.has(requiredTool), `execution must call ${requiredTool}`);
  }
  assert.ok(toolNames.has("build_schedule"), "an explicit agenda request must call build_schedule");
  assert.ok(
    executed.payload.result.milestones.filter((item) => /\d{1,2}:\d{2}/.test(item.date)).length >=
      2,
    "the agenda must include actual time slots in the visible timeline",
  );
  assert.ok(
    executed.payload.result.artifacts.some((artifact) => artifact.type === "document"),
    "execution must produce an editable document artifact",
  );
  assert.ok(
    executed.payload.result.artifacts.some((artifact) => artifact.type === "timeline"),
    "execution must produce a timeline artifact",
  );
  assert.ok(
    executed.payload.result.artifacts.some((artifact) => artifact.type === "budget"),
    "execution must produce a budget artifact when the goal includes a budget",
  );
  assert.ok(
    executed.payload.result.budget?.limit === 800 &&
      executed.payload.result.budget.total > 0 &&
      executed.payload.result.budget.total <= 800,
    `budget estimates must respect the user's stated 800 yuan limit: ${JSON.stringify(executed.payload.result.budget)}; ${JSON.stringify(executed.payload.result.artifacts.filter((artifact) => artifact.type === "budget"))}`,
  );
  check(
    true,
    `Execute ${liveMode ? "live" : "demo"} tools (${[...toolNames].join(", ")}) and produce artifacts`,
  );
  if (liveMode)
    check(true, "Stream live Agent status, tool completion events, and the final workspace result");
  check(
    true,
    liveMode
      ? "Report provider-reported model usage and request latency for live execution"
      : "Keep demo execution free of fabricated model usage",
  );
  if (liveMode) {
    const savedUsage = database
      .prepare(
        "SELECT COUNT(*) AS requests, COALESCE(SUM(total_tokens), 0) AS totalTokens FROM ai_usage WHERE user_id = ?",
      )
      .get(testUserId);
    assert.ok(
      savedUsage.requests >=
        planned.payload.usage.requests + executed.payload.result.usage.requests,
    );
    assert.ok(
      savedUsage.totalTokens >=
        planned.payload.usage.totalTokens + executed.payload.result.usage.totalTokens,
    );
    check(true, "Persist real provider-reported planning and execution usage for admin reporting");

    const workspaceUsageBeforeCancellation = persistedExecutionWorkspace.usage.totalTokens;
    const usageRowsBeforeCancellation = database
      .prepare(
        "SELECT COUNT(*) AS requests, COALESCE(SUM(total_tokens), 0) AS totalTokens FROM ai_usage WHERE user_id = ?",
      )
      .get(testUserId);
    const cancellationController = new AbortController();
    const cancellationResponse = await fetch(new URL("/api/execute", baseUrl), {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
        Cookie: sessionCookie,
        "X-Forwarded-For": smokeClientAddress,
      },
      body: JSON.stringify({
        workspaceId: plannedWorkspaceId,
        goal: prompt,
        instruction: "联网搜索校园活动安全规范，并为活动报名网页生成一个可运行的单页代码项目。",
        continuation: true,
        plan,
        route: plan.routes[0],
        currentTasks: executed.payload.result.tasks,
        currentMilestones: executed.payload.result.milestones,
        currentBudget: executed.payload.result.budget,
        demo: false,
        thinkingMode: "fast",
      }),
      signal: AbortSignal.any([cancellationController.signal, AbortSignal.timeout(120_000)]),
    });
    assert.equal(cancellationResponse.status, 200);
    assert.match(cancellationResponse.headers.get("content-type") || "", /text\/event-stream/i);
    assert.ok(cancellationResponse.body);
    const cancellationReader = cancellationResponse.body.getReader();
    const cancellationDecoder = new TextDecoder();
    let cancellationBuffer = "";
    let completedCancellationTool;
    while (!completedCancellationTool) {
      const { done, value } = await cancellationReader.read();
      if (done) break;
      cancellationBuffer += cancellationDecoder.decode(value, { stream: true });
      let boundary = cancellationBuffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = cancellationBuffer.slice(0, boundary);
        cancellationBuffer = cancellationBuffer.slice(boundary + 2);
        const serialized = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (serialized) {
          const event = JSON.parse(serialized);
          if (event.type === "tool" && event.status === "done") {
            completedCancellationTool = event;
            break;
          }
        }
        boundary = cancellationBuffer.indexOf("\n\n");
      }
    }
    assert.equal(
      completedCancellationTool?.name,
      "search_web",
      "the cancellation fixture must reach its first completed required tool",
    );
    let usageRowsAfterTool;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      usageRowsAfterTool = database
        .prepare(
          "SELECT COUNT(*) AS requests, COALESCE(SUM(total_tokens), 0) AS totalTokens FROM ai_usage WHERE user_id = ?",
        )
        .get(testUserId);
      if (usageRowsAfterTool.requests > usageRowsBeforeCancellation.requests) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(
      usageRowsAfterTool.totalTokens > usageRowsBeforeCancellation.totalTokens,
      "the completed model step must be recorded before cancelling the next step",
    );
    cancellationController.abort();
    await cancellationReader.cancel().catch(() => {});

    let cancelledWorkspace;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await request(`/api/workspaces/${plannedWorkspaceId}`, {
        cookie: sessionCookie,
      });
      assert.equal(response.response.status, 200);
      cancelledWorkspace = response.payload.workspace;
      if (cancelledWorkspace.usage.totalTokens > workspaceUsageBeforeCancellation) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const usageRowsAfterCancellation = database
      .prepare(
        "SELECT COUNT(*) AS requests, COALESCE(SUM(total_tokens), 0) AS totalTokens FROM ai_usage WHERE user_id = ?",
      )
      .get(testUserId);
    const completedStepUsageDelta =
      usageRowsAfterCancellation.totalTokens - usageRowsBeforeCancellation.totalTokens;
    assert.ok(completedStepUsageDelta > 0);
    assert.equal(
      cancelledWorkspace.usage.totalTokens,
      workspaceUsageBeforeCancellation + completedStepUsageDelta,
      "cancelled runs must persist the completed model usage without saving partial artifacts",
    );
    workspaceUsageAfterCancellation = cancelledWorkspace.usage.totalTokens;
    assert.deepEqual(
      cancelledWorkspace.result,
      persistedExecutionWorkspace.result,
      "cancelling before the result commit must preserve all prior tasks and artifacts",
    );
    check(
      true,
      "Persist completed-step model usage after cancelling without committing partial execution output",
    );
  }

  if (liveMode) {
    const beforeTaskIds = new Set(executed.payload.result.tasks.map((task) => task.id));
    const beforeMilestones = executed.payload.result.milestones;
    const beforeBudget = executed.payload.result.budget;
    const continuationTaskCode = crypto.randomUUID().slice(0, 8);
    const continuation = await request("/api/execute", {
      method: "POST",
      cookie: sessionCookie,
      body: {
        workspaceId: plannedWorkspaceId,
        goal: prompt,
        instruction: `请只新增一项任务：制作并打印 8 张志愿者姓名胸牌，任务标题必须包含唯一校验码 ${continuationTaskCode}。不要改动已有任务、时间线、预算或行动方案。`,
        continuation: true,
        plan,
        route: plan.routes[0],
        currentTasks: executed.payload.result.tasks,
        currentMilestones: beforeMilestones,
        currentBudget: beforeBudget,
        demo: false,
      },
      timeoutMs: 210_000,
    });
    assert.equal(
      continuation.response.status,
      200,
      `continuation must succeed: ${continuation.payload?.error || ""}`,
    );
    const continued = continuation.payload.result;
    assert.equal(continued.usage?.model, "deepseek-flash");
    assert.ok(continued.usage?.totalTokens > 0);
    if (continued.usage.cachedInputTokens !== undefined) {
      assert.ok(continued.usage.cachedInputTokens <= continued.usage.inputTokens);
    }
    const continuationTools = new Set(continued.events.map((event) => event.name));
    const newTasks = continued.tasks.filter((task) => !beforeTaskIds.has(task.id));
    assert.equal(newTasks.length, 1, "a one-task instruction must not create extra tasks");
    assert.ok(
      newTasks.some(
        (task) =>
          /胸牌|名牌|工牌/.test(task.title + task.detail) &&
          task.title.includes(continuationTaskCode),
      ),
      `continuation must add the specifically requested volunteer-badge task; got ${JSON.stringify(newTasks)}`,
    );
    assert.ok(
      executed.payload.result.tasks.every((task) =>
        continued.tasks.some((item) => item.id === task.id),
      ),
      "continuation must preserve all existing task IDs",
    );
    assert.deepEqual(continued.milestones, beforeMilestones);
    assert.deepEqual(continued.budget, beforeBudget);
    assert.ok(continuationTools.has("create_tasks"));
    assert.equal(continuationTools.has("build_timeline"), false);
    assert.equal(continuationTools.has("calculate_budget"), false);
    assert.equal(continuationTools.has("draft_document"), false);
    const persistedContinuation = await request(`/api/workspaces/${plannedWorkspaceId}`, {
      cookie: sessionCookie,
    });
    assert.deepEqual(persistedContinuation.payload.workspace.result.tasks, continued.tasks);
    assert.equal(
      persistedContinuation.payload.workspace.result.events.length,
      executed.payload.result.events.length + continued.events.length,
    );
    assert.equal(
      persistedContinuation.payload.workspace.usage.totalTokens,
      workspaceUsageAfterCancellation + continued.usage.totalTokens,
    );
    check(
      true,
      "Apply a live follow-up instruction while preserving unrelated tasks, timeline, and budget",
    );
    check(true, "Persist follow-up tool results before returning the stream result");

    const artifactCreation = await request("/api/execute", {
      method: "POST",
      cookie: sessionCookie,
      body: {
        workspaceId: plannedWorkspaceId,
        goal: prompt,
        instruction:
          "请直接生成三个可交付文件：一个可运行的单页 HTML 签到原型源码项目、一个简洁的志愿者签到 Excel 工作簿、一个至少两页的活动介绍 PPT 演示文稿。不要只写计划，也不要新增任务。",
        continuation: true,
        plan,
        route: plan.routes[0],
        currentTasks: continued.tasks,
        currentMilestones: continued.milestones,
        currentBudget: continued.budget,
        demo: false,
      },
      timeoutMs: 210_000,
    });
    assert.equal(
      artifactCreation.response.status,
      200,
      `artifact generation must succeed: ${artifactCreation.payload?.error || ""}`,
    );
    const generated = artifactCreation.payload.result;
    const artifactFailure =
      artifactCreation.payload?.error ||
      artifactCreation.streamEvents.find((event) => event.type === "error")?.error ||
      "Agent returned no artifact result.";
    assert.ok(
      generated?.events,
      `artifact generation must return a result: ${artifactFailure}; ${JSON.stringify(artifactCreation.streamEvents.slice(-3))}`,
    );
    const generatedTools = new Set(generated.events.map((event) => event.name));
    const codeProject = generated.artifacts.find((artifact) => artifact.type === "code");
    const workbookArtifact = generated.artifacts.find(
      (artifact) => artifact.type === "spreadsheet",
    );
    const presentationArtifact = generated.artifacts.find(
      (artifact) => artifact.type === "presentation",
    );
    assert.ok(generatedTools.has("create_project"));
    assert.ok(generatedTools.has("generate_spreadsheet"));
    assert.ok(generatedTools.has("generate_presentation"));
    assert.ok(codeProject?.files?.length);
    assert.ok(workbookArtifact?.content);
    assert.ok(presentationArtifact?.content);
    assert.ok(codeProject.files.some((file) => file.path.toLowerCase() === "readme.md"));
    assert.ok(codeProject.files.some((file) => /(?:index\.html|package\.json)/i.test(file.path)));
    const generatedWorkbook = JSON.parse(workbookArtifact.content);
    assert.ok(generatedWorkbook.sheets?.length);
    assert.ok(generatedWorkbook.sheets[0].columns?.length);
    assert.ok(generatedWorkbook.sheets[0].rows?.length);
    const generatedPresentation = JSON.parse(presentationArtifact.content);
    assert.ok(generatedPresentation.slides?.length >= 2);
    check(
      true,
      "Generate a real code project, structured Excel workbook, and multi-slide PowerPoint",
    );

    const webSearch = await request("/api/execute", {
      method: "POST",
      cookie: sessionCookie,
      body: {
        workspaceId: plannedWorkspaceId,
        goal: prompt,
        instruction:
          "请联网搜索 Next.js 官方文档中 instrumentation 的说明，并根据搜索结果简要回答。回答里给出来源链接，不要改动任何任务或产物。",
        continuation: true,
        plan,
        route: plan.routes[0],
        currentTasks: generated.tasks,
        currentMilestones: generated.milestones,
        currentBudget: generated.budget,
        demo: false,
      },
      timeoutMs: 90_000,
    });
    assert.equal(
      webSearch.response.status,
      200,
      "live web search must succeed: " + (webSearch.payload?.error || ""),
    );
    const searchEvent = webSearch.payload.result.events.find(
      (event) => event.name === "search_web",
    );
    assert.ok(searchEvent, "an explicit web-search request must invoke search_web");
    assert.ok(searchEvent.sources?.length, "search results must retain their source links");
    assert.ok(
      searchEvent.sources.every((source) => /^https?:\/\//i.test(source.url)),
      "search results must expose only safe HTTP(S) URLs",
    );
    assert.ok(
      webSearch.streamEvents.some(
        (event) => event.type === "tool" && event.name === "search_web" && event.sources?.length,
      ),
      "the live stream must publish clickable sources as soon as search completes",
    );
    check(
      true,
      "Search the web with the live Agent and stream verified source links into the workspace",
    );
  }

  for (const workspaceId of livePlanWorkspaceIds) {
    const removed = await request(`/api/workspaces/${workspaceId}`, {
      method: "DELETE",
      cookie: sessionCookie,
    });
    assert.equal(removed.response.status, 200);
  }

  const unicodeCodeArtifact = {
    id: crypto.randomUUID(),
    type: "code",
    title: "本地化项目文件",
    description: "包含中文和空格路径的可下载源码。",
    content: "项目文件：README.md、index.html、src/活动 页面/入口 文件.tsx",
    files: [
      { path: "README.md", content: "运行 npm run dev" },
      { path: "index.html", content: "<!doctype html><title>localized</title>" },
      { path: "src/活动 页面/入口 文件.tsx", content: "export default function Page() {}" },
    ],
  };
  const workspace = {
    id: crypto.randomUUID(),
    prompt,
    plan,
    selectedRouteId: plan.routes[0].id,
    result: {
      ...executed.payload.result,
      artifacts: [...executed.payload.result.artifacts, unicodeCodeArtifact],
    },
    createdAt: new Date().toISOString(),
    mode: executed.payload.mode,
  };
  const saved = await request("/api/workspaces", {
    method: "POST",
    cookie: sessionCookie,
    body: { workspace },
  });
  assert.equal(saved.response.status, 200, "workspace save must succeed");
  const singleWorkspaceRead = await request(`/api/workspaces/${workspace.id}`, {
    cookie: sessionCookie,
  });
  assert.equal(singleWorkspaceRead.response.status, 200);
  assert.equal(singleWorkspaceRead.payload?.workspace?.id, workspace.id);
  assert.ok(
    singleWorkspaceRead.payload.workspace.result.artifacts
      .find((artifact) => artifact.id === unicodeCodeArtifact.id)
      .files.some((file) => file.path === "src/活动 页面/入口 文件.tsx"),
  );
  const unicodeOversizedWorkspace = {
    ...workspace,
    id: crypto.randomUUID(),
    result: {
      ...workspace.result,
      artifacts: Array.from({ length: 8 }, (_, index) => {
        const artifact = workspace.result.artifacts[index % workspace.result.artifacts.length];
        return {
          ...artifact,
          id: crypto.randomUUID(),
          title: `${artifact.title} ${index + 1}`,
          content: "界".repeat(12_000),
        };
      }),
    },
  };
  const unicodeSerialized = JSON.stringify(unicodeOversizedWorkspace);
  assert.ok(unicodeSerialized.length < 250_000);
  assert.ok(Buffer.byteLength(unicodeSerialized, "utf8") > 250_000);
  const unicodeOversizedSave = await request("/api/workspaces", {
    method: "POST",
    cookie: sessionCookie,
    body: { workspace: unicodeOversizedWorkspace },
  });
  assert.equal(unicodeOversizedSave.response.status, 400);
  assert.match(unicodeOversizedSave.payload?.error || "", /250 KB/);
  check(true, "Enforce workspace size in UTF-8 bytes for multibyte content");
  const history = await request("/api/workspaces", { cookie: sessionCookie });
  assert.equal(history.response.status, 200);
  assert.ok(history.payload?.workspaces?.some((item) => item.id === workspace.id));
  const crossOriginWorkspaceDelete = await request(`/api/workspaces/${workspace.id}`, {
    method: "DELETE",
    cookie: sessionCookie,
    headers: { Origin: "https://attacker.example" },
  });
  assert.equal(crossOriginWorkspaceDelete.response.status, 403);
  const retainedHistory = await request("/api/workspaces", { cookie: sessionCookie });
  assert.ok(retainedHistory.payload?.workspaces?.some((item) => item.id === workspace.id));
  check(true, "Reject cross-origin workspace deletion while preserving the saved goal");
  const malformed = await request("/api/workspaces", {
    method: "POST",
    cookie: sessionCookie,
    body: { workspace: { ...workspace, plan: { title: "incomplete" } } },
  });
  assert.equal(malformed.response.status, 400, "invalid workspace data must be rejected");
  const invalidCachedUsage = await request("/api/workspaces", {
    method: "POST",
    cookie: sessionCookie,
    body: {
      workspace: {
        ...workspace,
        id: crypto.randomUUID(),
        usage: {
          model: "deepseek-flash",
          inputTokens: 20,
          cachedInputTokens: 21,
          outputTokens: 5,
          totalTokens: 25,
          latencyMs: 10,
          requests: 1,
        },
      },
    },
  });
  assert.equal(invalidCachedUsage.response.status, 400);
  const updatedWorkspace = {
    ...workspace,
    prompt: "Updated smoke target",
    plan: { ...plan, title: "Updated smoke workspace" },
  };
  const updated = await request("/api/workspaces", {
    method: "POST",
    cookie: sessionCookie,
    body: { workspace: updatedWorkspace },
  });
  assert.equal(updated.response.status, 200, "owners must be able to update their workspace");
  const updatedHistory = await request("/api/workspaces", { cookie: sessionCookie });
  assert.equal(
    updatedHistory.payload?.workspaces?.filter((item) => item.id === workspace.id).length,
    1,
    "updating a workspace must not create a duplicate record",
  );
  assert.equal(
    updatedHistory.payload?.workspaces?.find((item) => item.id === workspace.id)?.plan.title,
    updatedWorkspace.plan.title,
  );
  check(true, "Persist, update, retrieve, and validate a private workspace");

  const accountExport = await request("/api/account/export", { cookie: sessionCookie });
  assert.equal(accountExport.response.status, 200);
  assert.ok(accountExport.payload?.workspaces?.some((item) => item.id === workspace.id));
  assert.ok(
    accountExport.payload?.knowledge?.some(
      (document) => document.id === knowledge.payload.document.id,
    ),
  );
  assert.equal(accountExport.payload?.user?.id, testUserId);
  for (const secretField of ["password_hash", "recovery_code_hash", "session_version"]) {
    assert.equal(secretField in accountExport.payload.user, false);
  }
  check(true, "Export only the signed-in user's workspaces and knowledge without auth secrets");
  const unauthenticatedExport = await request("/api/account/export");
  assert.equal(unauthenticatedExport.response.status, 401);
  const unauthenticatedExecutionStatuses = await request("/api/executions");
  assert.equal(unauthenticatedExecutionStatuses.response.status, 401);
  const unauthenticatedImport = await request("/api/account/import", {
    method: "POST",
    body: accountExport.payload,
  });
  assert.equal(unauthenticatedImport.response.status, 401);
  const unsupportedBackup = await request("/api/account/import", {
    method: "POST",
    cookie: sessionCookie,
    body: { ...accountExport.payload, formatVersion: 999 },
  });
  assert.equal(unsupportedBackup.response.status, 400);
  const rekeyBoundaryWorkspace = {
    ...structuredClone(workspace),
    id: "w",
    plan: {
      ...workspace.plan,
      tasks: Array.from({ length: 40 }, (_, index) => ({
        ...workspace.plan.tasks[index % workspace.plan.tasks.length],
        id: `p${index}`,
      })),
    },
    result: {
      ...workspace.result,
      tasks: Array.from({ length: 60 }, (_, index) => ({
        ...workspace.result.tasks[index % workspace.result.tasks.length],
        id: `t${index}`,
      })),
      milestones: Array.from({ length: 100 }, (_, index) => ({
        label: `阶段 ${index + 1}`,
        date: "待定",
        note: "节点备注。".repeat(8),
      })),
      artifacts: Array.from({ length: 20 }, (_, index) => ({
        id: `a${index}`,
        type: ["document", "timeline", "budget"][index % 3],
        title: `产物 ${index + 1}`,
        description: "边界测试产物",
        content: "x".repeat(500),
      })),
      events: Array.from({ length: 100 }, (_, index) => ({
        id: `e${index}`,
        name: "smoke",
        title: `记录 ${index + 1}`,
        detail: "事件备注。".repeat(12),
        status: "done",
      })),
    },
  };
  const rekeyTargetBytes = 247_000;
  let remainingBytes = rekeyTargetBytes - Buffer.byteLength(JSON.stringify(rekeyBoundaryWorkspace));
  for (const artifact of rekeyBoundaryWorkspace.result.artifacts) {
    if (remainingBytes <= 0) break;
    const extra = Math.min(15_000 - artifact.content.length, remainingBytes);
    artifact.content += "x".repeat(extra);
    remainingBytes -= extra;
  }
  const sourceWorkspaceBytes = Buffer.byteLength(JSON.stringify(rekeyBoundaryWorkspace), "utf8");
  const remappedWorkspace = structuredClone(rekeyBoundaryWorkspace);
  remappedWorkspace.id = "0".repeat(36);
  remappedWorkspace.plan.tasks = remappedWorkspace.plan.tasks.map((task) => ({
    ...task,
    id: "0".repeat(36),
  }));
  remappedWorkspace.result.tasks = remappedWorkspace.result.tasks.map((task) => ({
    ...task,
    id: "0".repeat(36),
  }));
  remappedWorkspace.result.artifacts = remappedWorkspace.result.artifacts.map((artifact) => ({
    ...artifact,
    id: "0".repeat(36),
  }));
  remappedWorkspace.result.events = remappedWorkspace.result.events.map((event) => ({
    ...event,
    id: "0".repeat(36),
  }));
  assert.ok(sourceWorkspaceBytes <= 250_000 && sourceWorkspaceBytes > 240_000);
  assert.ok(Buffer.byteLength(JSON.stringify(remappedWorkspace), "utf8") > 250_000);
  const rekeyOversizedImport = await request("/api/account/import", {
    method: "POST",
    cookie: sessionCookie,
    body: { ...accountExport.payload, workspaces: [rekeyBoundaryWorkspace], knowledge: [] },
  });
  assert.equal(rekeyOversizedImport.response.status, 400);
  assert.match(rekeyOversizedImport.payload?.error || "", /重新映射 ID 后/);
  const afterRejectedRekeyImport = await request("/api/workspaces", { cookie: sessionCookie });
  assert.equal(afterRejectedRekeyImport.payload?.workspaces?.length, 1);
  check(true, "Reject a backup that would exceed the byte cap after IDs are remapped");
  const importedBackup = await request("/api/account/import", {
    method: "POST",
    cookie: sessionCookie,
    body: accountExport.payload,
  });
  assert.equal(importedBackup.response.status, 201, importedBackup.payload?.error);
  assert.deepEqual(importedBackup.payload?.imported, { workspaces: 1, knowledge: 1 });
  const ownerAfterImport = await request("/api/workspaces", { cookie: sessionCookie });
  const importedWorkspace = ownerAfterImport.payload?.workspaces?.find(
    (item) => item.id !== workspace.id,
  );
  assert.equal(ownerAfterImport.payload?.workspaces?.length, 2);
  assert.ok(importedWorkspace, "import must allocate a new workspace ID");
  const ownerKnowledgeAfterImport = await request("/api/knowledge", { cookie: sessionCookie });
  assert.equal(ownerKnowledgeAfterImport.payload?.documents?.length, 2);
  const importedKnowledge = ownerKnowledgeAfterImport.payload?.documents?.find(
    (item) => item.id !== knowledge.payload.document.id,
  );
  assert.ok(importedKnowledge, "import must allocate a new knowledge ID");
  assert.equal(importedWorkspace.plan.sources[0]?.id, importedKnowledge.id);
  check(
    true,
    "Import account backups safely, rekey records, remap knowledge references, and enforce authentication",
  );

  const admin = await request("/api/admin/overview", { cookie: sessionCookie });
  assert.equal(
    admin.response.status,
    registration.payload.user.role === "admin" ? 200 : 403,
    "admin access must match the account role",
  );
  check(true, "Enforce the role boundary for the admin API");

  const outsiderRegistration = await request("/api/auth/register", {
    method: "POST",
    body: { name: "NEXORA Outsider", email: outsiderEmail, password: outsiderPassword },
  });
  assert.equal(outsiderRegistration.response.status, 200);
  const outsiderId = outsiderRegistration.payload?.user?.id;
  assert.ok(outsiderId);
  testUserIds.push(outsiderId);
  const forbiddenAiStatus = await request("/api/admin/ai-status", {
    method: "POST",
    cookie: (
      outsiderRegistration.response.headers.getSetCookie?.()[0] ||
      outsiderRegistration.response.headers.get("set-cookie")
    )?.split(";")[0],
  });
  assert.equal(forbiddenAiStatus.response.status, 403, "members cannot test the platform AI key");
  const outsiderCookie = (
    outsiderRegistration.response.headers.getSetCookie?.()[0] ||
    outsiderRegistration.response.headers.get("set-cookie")
  )?.split(";")[0];
  assert.ok(outsiderCookie);

  const sharingWorkspace = {
    ...workspace,
    id: crypto.randomUUID(),
    prompt: "Sharing permission smoke fixture",
    conversation: [],
  };
  const savedSharingWorkspace = await request("/api/workspaces", {
    method: "POST",
    cookie: sessionCookie,
    body: { workspace: sharingWorkspace },
  });
  assert.equal(savedSharingWorkspace.response.status, 200);
  const viewerLink = await request(`/api/workspaces/${sharingWorkspace.id}/sharing`, {
    method: "POST",
    cookie: sessionCookie,
    body: { role: "viewer", expiresInDays: 7 },
  });
  assert.equal(viewerLink.response.status, 200, viewerLink.payload?.error);
  const viewerLinkId = (
    await request(`/api/workspaces/${sharingWorkspace.id}/sharing`, { cookie: sessionCookie })
  ).payload?.links?.find((item) => item.role === "viewer")?.id;
  assert.ok(viewerLinkId);
  const viewerToken = new URL(viewerLink.payload.inviteUrl).pathname.split("/").at(-1);
  const viewerAccepted = await request("/api/workspace-invites/accept", {
    method: "POST",
    cookie: outsiderCookie,
    body: { token: viewerToken },
  });
  assert.equal(viewerAccepted.response.status, 200);
  assert.equal(viewerAccepted.payload?.role, "viewer");
  const viewerHistory = await request("/api/workspaces", { cookie: outsiderCookie });
  assert.equal(viewerHistory.payload?.accessByWorkspaceId?.[sharingWorkspace.id], "viewer");
  const viewerWorkspaceRead = await request(`/api/workspaces/${sharingWorkspace.id}`, {
    cookie: outsiderCookie,
  });
  assert.equal(viewerWorkspaceRead.response.status, 200);
  assert.equal(viewerWorkspaceRead.payload?.accessRole, "viewer");
  const viewerWrite = await request("/api/workspaces", {
    method: "POST",
    cookie: outsiderCookie,
    body: { workspace: { ...sharingWorkspace, prompt: "viewer must not write" } },
  });
  assert.equal(viewerWrite.response.status, 403);
  const viewerChat = await request("/api/chat", {
    method: "POST",
    cookie: outsiderCookie,
    body: { workspaceId: sharingWorkspace.id, question: "请继续推进" },
  });
  assert.equal(viewerChat.response.status, 403);
  const viewerManageShare = await request(`/api/workspaces/${sharingWorkspace.id}/sharing`, {
    cookie: outsiderCookie,
  });
  assert.equal(viewerManageShare.response.status, 403);
  const removedViewer = await request(`/api/workspaces/${sharingWorkspace.id}/sharing`, {
    method: "DELETE",
    cookie: sessionCookie,
    body: { memberId: outsiderId },
  });
  assert.equal(removedViewer.response.status, 200);
  const revokedViewerLink = await request(`/api/workspaces/${sharingWorkspace.id}/sharing`, {
    method: "DELETE",
    cookie: sessionCookie,
    body: { linkId: viewerLinkId },
  });
  assert.equal(revokedViewerLink.response.status, 200);
  const rejectedRevokedInvite = await request("/api/workspace-invites/accept", {
    method: "POST",
    cookie: outsiderCookie,
    body: { token: viewerToken },
  });
  assert.equal(rejectedRevokedInvite.response.status, 410);

  const editorLink = await request(`/api/workspaces/${sharingWorkspace.id}/sharing`, {
    method: "POST",
    cookie: sessionCookie,
    body: { role: "editor", expiresInDays: 7 },
  });
  assert.equal(editorLink.response.status, 200, editorLink.payload?.error);
  const editorLinkId = (
    await request(`/api/workspaces/${sharingWorkspace.id}/sharing`, { cookie: sessionCookie })
  ).payload?.links?.find((item) => item.role === "editor")?.id;
  assert.ok(editorLinkId);
  const editorToken = new URL(editorLink.payload.inviteUrl).pathname.split("/").at(-1);
  const editorAccepted = await request("/api/workspace-invites/accept", {
    method: "POST",
    cookie: outsiderCookie,
    body: { token: editorToken },
  });
  assert.equal(editorAccepted.response.status, 200);
  assert.equal(editorAccepted.payload?.role, "editor");
  const editorWrite = await request("/api/workspaces", {
    method: "POST",
    cookie: outsiderCookie,
    body: { workspace: { ...sharingWorkspace, prompt: "shared editor update" } },
  });
  assert.equal(editorWrite.response.status, 200, editorWrite.payload?.error);
  const editorCreateInvite = await request(`/api/workspaces/${sharingWorkspace.id}/sharing`, {
    method: "POST",
    cookie: outsiderCookie,
    body: { role: "viewer" },
  });
  assert.equal(editorCreateInvite.response.status, 403);

  const sharedExecutionToken = crypto.randomUUID();
  const sharedExecutionTime = new Date().toISOString();
  database
    .prepare(
      "INSERT INTO workspace_execution_locks (workspace_id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run(sharingWorkspace.id, testUserId, sharedExecutionToken, Date.now() + 60_000);
  database
    .prepare(
      `INSERT INTO workspace_execution_status
        (token, workspace_id, user_id, workspace_title, state, activity, completed_tool_calls,
         message, started_at, updated_at, finished_at)
       VALUES (?, ?, ?, ?, 'running', ?, 1, NULL, ?, ?, NULL)`,
    )
    .run(
      sharedExecutionToken,
      sharingWorkspace.id,
      testUserId,
      sharingWorkspace.plan.title,
      "共享工作区后台执行中",
      sharedExecutionTime,
      sharedExecutionTime,
    );
  const editorExecutionStatus = await request("/api/executions", { cookie: outsiderCookie });
  assert.ok(
    editorExecutionStatus.payload?.executions?.some(
      (item) => item.token === sharedExecutionToken && item.workspaceId === sharingWorkspace.id,
    ),
    "editors should see the shared workspace's current execution state",
  );
  const editorCancel = await request("/api/executions", {
    method: "POST",
    cookie: outsiderCookie,
    body: { workspaceId: sharingWorkspace.id },
  });
  assert.equal(editorCancel.payload?.cancelled, true);
  const ownerSeesEditorCancellation = await request("/api/executions", { cookie: sessionCookie });
  assert.ok(
    ownerSeesEditorCancellation.payload?.executions?.some(
      (item) => item.token === sharedExecutionToken && item.cancelRequested,
    ),
  );
  database
    .prepare("DELETE FROM workspace_execution_locks WHERE workspace_id = ? AND token = ?")
    .run(sharingWorkspace.id, sharedExecutionToken);
  database
    .prepare("DELETE FROM workspace_execution_status WHERE token = ?")
    .run(sharedExecutionToken);
  const removedEditor = await request(`/api/workspaces/${sharingWorkspace.id}/sharing`, {
    method: "DELETE",
    cookie: sessionCookie,
    body: { memberId: outsiderId },
  });
  assert.equal(removedEditor.response.status, 200);
  const revokedEditorLink = await request(`/api/workspaces/${sharingWorkspace.id}/sharing`, {
    method: "DELETE",
    cookie: sessionCookie,
    body: { linkId: editorLinkId },
  });
  assert.equal(revokedEditorLink.response.status, 200);
  const deletedSharingWorkspace = await request(`/api/workspaces/${sharingWorkspace.id}`, {
    method: "DELETE",
    cookie: sessionCookie,
  });
  assert.equal(deletedSharingWorkspace.response.status, 200);
  check(
    true,
    "Exercise viewer/editor invites, read-only boundaries, revocation, shared progress, and editor cancellation",
  );

  const executionStatusToken = crypto.randomUUID();
  const executionStatusTime = new Date().toISOString();
  database
    .prepare(
      "INSERT INTO workspace_execution_locks (workspace_id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run(workspace.id, testUserId, executionStatusToken, Date.now() + 60_000);
  database
    .prepare(
      `INSERT INTO workspace_execution_status
        (token, workspace_id, user_id, workspace_title, state, activity, completed_tool_calls,
         message, started_at, updated_at, finished_at)
       VALUES (?, ?, ?, ?, 'running', ?, 2, NULL, ?, ?, NULL)`,
    )
    .run(
      executionStatusToken,
      workspace.id,
      testUserId,
      workspace.plan.title,
      "正在生成可下载的代码项目",
      executionStatusTime,
      executionStatusTime,
    );
  const ownerExecutionStatuses = await request("/api/executions", { cookie: sessionCookie });
  assert.equal(ownerExecutionStatuses.response.status, 200);
  assert.match(ownerExecutionStatuses.response.headers.get("cache-control") || "", /no-store/i);
  assert.deepEqual(ownerExecutionStatuses.payload?.executions?.[0], {
    token: executionStatusToken,
    workspaceId: workspace.id,
    workspaceTitle: workspace.plan.title,
    state: "running",
    activity: "正在生成可下载的代码项目",
    completedToolCalls: 2,
    startedAt: executionStatusTime,
    updatedAt: executionStatusTime,
  });
  const progressDialogue = await request("/api/chat", {
    method: "POST",
    cookie: sessionCookie,
    body: {
      workspaceId: workspace.id,
      question: "做到哪里了？",
      thinkingMode: "deep",
    },
  });
  assert.equal(progressDialogue.response.status, 200, progressDialogue.payload?.error);
  assert.equal(progressDialogue.payload?.kind, "reply");
  assert.match(progressDialogue.payload?.answer || "", /正在生成可下载的代码项目/);
  assert.match(progressDialogue.payload?.answer || "", /2 次工具操作/);
  const progressDialogueWorkspace = await request(`/api/workspaces/${workspace.id}`, {
    cookie: sessionCookie,
  });
  assert.equal(
    progressDialogueWorkspace.payload?.workspace?.conversation?.at(-1)?.agent,
    "dialogue",
    "the persisted progress reply should retain its dialogue-Agent identity",
  );
  const executionAfterProgressDialogue = await request("/api/executions", {
    cookie: sessionCookie,
  });
  assert.equal(executionAfterProgressDialogue.payload?.executions?.[0]?.state, "running");
  check(true, "Persist dialogue-Agent progress replies while the workbench continues running");
  const queuedInstruction = "请直接生成并交付一个可下载运行的桌面计时器代码项目。";
  const queuedDialogue = await request("/api/chat", {
    method: "POST",
    cookie: sessionCookie,
    body: {
      workspaceId: workspace.id,
      question: queuedInstruction,
      thinkingMode: "deep",
    },
  });
  assert.equal(queuedDialogue.response.status, 200, queuedDialogue.payload?.error);
  assert.equal(queuedDialogue.payload?.kind, "handoff");
  assert.equal(queuedDialogue.payload?.queued, true);
  const pendingHandoffsDuringExecution = await request("/api/handoffs", {
    cookie: sessionCookie,
  });
  const queuedHandoff = pendingHandoffsDuringExecution.payload?.handoffs?.find(
    (handoff) => handoff.instruction === queuedInstruction,
  );
  assert.ok(queuedHandoff, "explicit new work should be durably queued during active execution");
  const blockedClaim = await request("/api/handoffs", {
    method: "PATCH",
    cookie: sessionCookie,
    body: { action: "claim", id: queuedHandoff.id },
  });
  assert.equal(blockedClaim.payload?.status, "busy");
  check(
    true,
    "Queue explicit new work during an active run and prevent it from taking over the workspace",
  );
  const outsiderExecutionStatuses = await request("/api/executions", { cookie: outsiderCookie });
  assert.equal(outsiderExecutionStatuses.response.status, 200);
  assert.deepEqual(outsiderExecutionStatuses.payload?.executions, []);
  const outsiderCancel = await request("/api/executions", {
    method: "POST",
    cookie: outsiderCookie,
    body: { workspaceId: workspace.id },
  });
  assert.equal(outsiderCancel.response.status, 200);
  assert.equal(outsiderCancel.payload?.cancelled, false);
  const ownerCancel = await request("/api/executions", {
    method: "POST",
    cookie: sessionCookie,
    body: { workspaceId: workspace.id },
  });
  assert.equal(ownerCancel.response.status, 200);
  assert.equal(ownerCancel.payload?.cancelled, true);
  const requestedCancellation = await request("/api/executions", { cookie: sessionCookie });
  assert.equal(requestedCancellation.payload?.executions?.[0]?.cancelRequested, true);
  assert.equal(requestedCancellation.payload?.executions?.[0]?.activity, "正在停止任务…");
  database
    .prepare(
      "UPDATE workspace_execution_status SET cancel_requested_at = NULL, activity = ?, updated_at = ? WHERE token = ?",
    )
    .run("正在生成可下载的代码项目", executionStatusTime, executionStatusToken);
  check(true, "Allow workspace owners to request cancellation and expose the stopping state");
  database
    .prepare(
      "UPDATE workspace_execution_locks SET expires_at = ? WHERE workspace_id = ? AND token = ?",
    )
    .run(Date.now() - 1, workspace.id, executionStatusToken);
  const interruptedExecutionStatuses = await request("/api/executions", { cookie: sessionCookie });
  assert.equal(interruptedExecutionStatuses.response.status, 200);
  assert.equal(interruptedExecutionStatuses.payload?.executions?.[0]?.state, "failed");
  assert.match(interruptedExecutionStatuses.payload?.executions?.[0]?.message || "", /连接已中断/);
  const releasedQueuedClaim = await request("/api/handoffs", {
    method: "PATCH",
    cookie: sessionCookie,
    body: { action: "claim", id: queuedHandoff.id },
  });
  assert.equal(releasedQueuedClaim.payload?.status, "claimed");
  assert.equal(releasedQueuedClaim.payload?.handoff?.instruction, queuedInstruction);
  const completedQueuedHandoff = await request("/api/handoffs", {
    method: "PATCH",
    cookie: sessionCookie,
    body: {
      action: "complete",
      id: queuedHandoff.id,
      token: releasedQueuedClaim.payload?.token,
    },
  });
  assert.equal(completedQueuedHandoff.payload?.ok, true);
  const pendingHandoffsAfterCompletion = await request("/api/handoffs", {
    cookie: sessionCookie,
  });
  assert.ok(
    !pendingHandoffsAfterCompletion.payload?.handoffs?.some(
      (handoff) => handoff.id === queuedHandoff.id,
    ),
  );
  check(true, "Release queued work after the previous run ends and remove it after completion");
  database
    .prepare("DELETE FROM workspace_execution_locks WHERE workspace_id = ? AND token = ?")
    .run(workspace.id, executionStatusToken);
  check(
    true,
    "Persist per-workspace execution activity, isolate status by account, and recover stale runs as interrupted",
  );
  const outsiderWorkspaceRead = await request(`/api/workspaces/${workspace.id}`, {
    cookie: outsiderCookie,
  });
  assert.equal(outsiderWorkspaceRead.response.status, 404);

  const outsiderHistory = await request("/api/workspaces", { cookie: outsiderCookie });
  assert.equal(outsiderHistory.response.status, 200);
  assert.ok(!outsiderHistory.payload?.workspaces?.some((item) => item.id === workspace.id));
  const workspaceHijack = await request("/api/workspaces", {
    method: "POST",
    cookie: outsiderCookie,
    body: {
      workspace: {
        ...workspace,
        prompt: "attempted cross-account overwrite",
        plan: { ...workspace.plan, title: "attempted takeover" },
      },
    },
  });
  assert.equal(workspaceHijack.response.status, 409, "accounts cannot overwrite another user's ID");
  const ownerHistory = await request("/api/workspaces", { cookie: sessionCookie });
  const originalWorkspace = ownerHistory.payload?.workspaces?.find(
    (item) => item.id === workspace.id,
  );
  assert.equal(originalWorkspace?.plan.title, updatedWorkspace.plan.title);
  assert.equal(originalWorkspace?.prompt, updatedWorkspace.prompt);
  const outsiderDeleteWorkspace = await request(`/api/workspaces/${workspace.id}`, {
    method: "DELETE",
    cookie: outsiderCookie,
  });
  assert.equal(outsiderDeleteWorkspace.response.status, 404);

  const outsiderDocuments = await request("/api/knowledge", { cookie: outsiderCookie });
  assert.equal(outsiderDocuments.response.status, 200);
  assert.ok(
    !outsiderDocuments.payload?.documents?.some(
      (item) => item.id === knowledge.payload?.document?.id,
    ),
  );
  const outsiderExport = await request("/api/account/export", { cookie: outsiderCookie });
  assert.equal(outsiderExport.response.status, 200);
  assert.equal(outsiderExport.payload?.user?.id, outsiderId);
  assert.equal(outsiderExport.payload?.workspaces?.length, 0);
  assert.equal(outsiderExport.payload?.knowledge?.length, 0);
  check(true, "Keep account backups isolated and inaccessible without an authenticated session");
  const outsiderDeleteDocument = await request(`/api/knowledge/${knowledge.payload.document.id}`, {
    method: "DELETE",
    cookie: outsiderCookie,
  });
  assert.equal(outsiderDeleteDocument.response.status, 404);
  const outsiderUpdateDocument = await request(`/api/knowledge/${knowledge.payload.document.id}`, {
    method: "PUT",
    cookie: outsiderCookie,
    body: {
      title: "Account takeover",
      content: "attempted cross-account knowledge overwrite that must not be accepted.",
    },
  });
  assert.equal(outsiderUpdateDocument.response.status, 404);
  const outsiderPlan = await request("/api/plan", {
    method: "POST",
    cookie: outsiderCookie,
    body: { prompt: "校内 AI 分享会面向本科生，场地优先选择图书馆报告厅。", demo: true },
  });
  assert.equal(outsiderPlan.response.status, 200);
  assert.deepEqual(outsiderPlan.payload?.plan?.sources, []);
  check(true, "Isolate workspaces, knowledge documents, and retrieval across accounts");
  const outsiderImport = await request("/api/account/import", {
    method: "POST",
    cookie: outsiderCookie,
    body: accountExport.payload,
  });
  assert.equal(outsiderImport.response.status, 201);
  assert.deepEqual(outsiderImport.payload?.imported, { workspaces: 1, knowledge: 1 });
  const outsiderImportedHistory = await request("/api/workspaces", { cookie: outsiderCookie });
  assert.equal(outsiderImportedHistory.payload?.workspaces?.length, 1);
  assert.notEqual(outsiderImportedHistory.payload?.workspaces?.[0]?.id, workspace.id);
  assert.equal(
    outsiderImportedHistory.payload?.workspaces?.[0]?.plan.sources[0]?.id ===
      accountExport.payload?.knowledge?.[0]?.id,
    false,
    "imports must remap knowledge references and assign them to the current account",
  );
  const outsiderImportedKnowledge = await request("/api/knowledge", { cookie: outsiderCookie });
  assert.equal(outsiderImportedKnowledge.payload?.documents?.length, 1);
  assert.notEqual(
    outsiderImportedKnowledge.payload?.documents?.[0]?.id,
    knowledge.payload.document.id,
  );
  const ownerStillIsolated = await request("/api/workspaces", { cookie: sessionCookie });
  assert.equal(ownerStillIsolated.payload?.workspaces?.length, 2);
  check(
    true,
    "Assign imported backup data to the signed-in account without affecting the backup owner",
  );

  database ||= new Database(resolveDatabasePath(), {
    timeout: 10_000,
  });
  database.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(testUserId);
  const addUsageFixture = database.prepare(
    "INSERT INTO ai_usage (id, user_id, workspace_id, source, operation, model, input_tokens, cached_input_tokens, cache_measured_input_tokens, cache_measured_hit_tokens, output_tokens, total_tokens, latency_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  addUsageFixture.run(
    crypto.randomUUID(),
    testUserId,
    workspace.id,
    "planner",
    "plan",
    "deepseek-flash",
    101,
    40,
    101,
    40,
    102,
    203,
    450,
    new Date().toISOString(),
  );
  database
    .prepare(
      "UPDATE ai_usage SET reasoning_tokens = ?, reasoning_measured_requests = ? WHERE user_id = ? AND workspace_id = ? AND source = 'planner'",
    )
    .run(9, 1, testUserId, workspace.id);
  addUsageFixture.run(
    crypto.randomUUID(),
    outsiderId,
    outsiderImportedHistory.payload.workspaces[0].id,
    "workbench",
    "execute",
    "deepseek-flash",
    201,
    70,
    201,
    70,
    202,
    403,
    850,
    new Date().toISOString(),
  );
  addUsageFixture.run(
    crypto.randomUUID(),
    testUserId,
    workspace.id,
    "reviewer",
    "execute",
    "deepseek-flash",
    250,
    25,
    250,
    25,
    50,
    300,
    650,
    new Date().toISOString(),
  );
  addUsageFixture.run(
    crypto.randomUUID(),
    testUserId,
    null,
    "healthcheck",
    "execute",
    "deepseek-flash",
    20,
    5,
    20,
    5,
    2,
    22,
    80,
    new Date().toISOString(),
  );
  if (liveMode) {
    const aiStatus = await request("/api/admin/ai-status", {
      method: "POST",
      cookie: sessionCookie,
      timeoutMs: 30_000,
    });
    assert.equal(
      aiStatus.response.status,
      200,
      `admin AI connectivity check must succeed: ${aiStatus.payload?.error || ""}`,
    );
    assert.equal(aiStatus.payload?.model, "deepseek-flash");
    assert.ok(Number.isFinite(aiStatus.payload?.latencyMs));
    check(true, "Verify the admin AI connectivity check reports the live model");
  } else if (identity.payload?.aiConfigured === false) {
    const unavailableAiStatus = await request("/api/admin/ai-status", {
      method: "POST",
      cookie: sessionCookie,
    });
    assert.equal(unavailableAiStatus.response.status, 503);
    assert.match(unavailableAiStatus.payload?.error || "", /尚未配置 DeepSeek API Key/);
  }
  const adminOverview = await request("/api/admin/overview", { cookie: sessionCookie });
  assert.equal(adminOverview.response.status, 200, "admins must be able to open the overview");
  assert.ok(adminOverview.payload?.users?.some((item) => item.id === outsiderId));
  assert.ok(Array.isArray(adminOverview.payload?.recentUsage));
  assert.ok(adminOverview.payload.recentUsage.length <= 100);
  const recentReviewerCall = adminOverview.payload.recentUsage.find(
    (item) => item.source === "reviewer" && item.workspaceId === workspace.id,
  );
  assert.ok(
    recentReviewerCall,
    `recent reviewer usage row for workspace ${workspace.id} must be present`,
  );
  assert.equal(
    recentReviewerCall?.inputTokens,
    250,
    "recent reviewer usage row must expose inputTokens",
  );
  assert.equal(recentReviewerCall?.outputTokens, 50);
  assert.equal(recentReviewerCall?.cacheMeasuredInputTokens, 250);
  assert.equal(recentReviewerCall?.cacheMeasuredHitTokens, 25);
  assert.equal(recentReviewerCall?.workspaceId, workspace.id);
  assert.equal("userId" in (recentReviewerCall || {}), false);
  assert.equal("prompt" in (recentReviewerCall || {}), false);
  assert.equal("attachments" in (recentReviewerCall || {}), false);
  check(true, "Expose recent per-call usage metadata without prompts, attachments, or account IDs");
  assert.ok(adminOverview.payload?.aiUsage?.totalTokens >= 606);
  assert.ok(adminOverview.payload?.aiUsage?.cachedInputTokens >= 110);
  assert.ok(adminOverview.payload?.aiUsage?.cacheMeasuredInputTokens >= 302);
  assert.ok(adminOverview.payload?.aiUsage?.cacheMeasuredHitTokens >= 110);
  assert.ok(adminOverview.payload?.aiUsage?.cacheMeasuredRequests >= 2);
  assert.ok(adminOverview.payload?.aiUsage?.cacheHitRequests >= 2);
  assert.ok(adminOverview.payload?.aiUsage?.flashInputTokens >= 20);
  assert.ok(adminOverview.payload?.aiUsage?.flashOutputTokens >= 2);
  assert.ok(adminOverview.payload?.aiUsage?.flashCacheMeasuredInputTokens >= 20);
  assert.ok(adminOverview.payload?.aiUsage?.flashCacheMeasuredHitTokens >= 0);
  assert.ok(adminOverview.payload?.aiUsage?.reasoningTokens >= 9);
  assert.ok(adminOverview.payload?.aiUsage?.reasoningMeasuredRequests >= 1);
  assert.ok(adminOverview.payload?.aiUsage?.planningRequests >= 1);
  assert.ok(adminOverview.payload?.aiUsage?.workbenchRequests >= 1);
  assert.ok(adminOverview.payload?.aiUsage?.reviewerRequests >= 1);
  assert.ok(adminOverview.payload?.aiUsage?.healthcheckRequests >= 1);
  const plannerCacheUsage = adminOverview.payload?.usageBySource?.find(
    (item) => item.source === "planner",
  );
  const workbenchCacheUsage = adminOverview.payload?.usageBySource?.find(
    (item) => item.source === "workbench",
  );
  const reviewerCacheUsage = adminOverview.payload?.usageBySource?.find(
    (item) => item.source === "reviewer",
  );
  const healthcheckCacheUsage = adminOverview.payload?.usageBySource?.find(
    (item) => item.source === "healthcheck",
  );
  assert.ok(plannerCacheUsage?.cacheMeasuredInputTokens >= 101);
  assert.ok(plannerCacheUsage?.cacheMeasuredHitTokens >= 40);
  assert.ok(plannerCacheUsage?.cacheMeasuredRequests >= 1);
  assert.ok(plannerCacheUsage?.cacheHitRequests >= 1);
  assert.ok(plannerCacheUsage?.reasoningTokens >= 9);
  assert.ok(plannerCacheUsage?.reasoningMeasuredRequests >= 1);
  assert.ok(workbenchCacheUsage?.cacheMeasuredInputTokens >= 201);
  assert.ok(workbenchCacheUsage?.cacheMeasuredHitTokens >= 70);
  assert.ok(reviewerCacheUsage?.cacheMeasuredInputTokens >= 250);
  assert.ok(reviewerCacheUsage?.cacheMeasuredHitTokens >= 25);
  assert.ok(reviewerCacheUsage?.cacheMeasuredRequests >= 1);
  assert.ok(reviewerCacheUsage?.cacheHitRequests >= 1);
  assert.ok(reviewerCacheUsage?.outputTokens >= 50);
  assert.ok(reviewerCacheUsage?.flashRequests >= 1);
  assert.ok(reviewerCacheUsage?.flashInputTokens >= 250);
  assert.ok(reviewerCacheUsage?.flashOutputTokens >= 50);
  assert.ok(reviewerCacheUsage?.flashCacheMeasuredInputTokens >= 250);
  assert.ok(reviewerCacheUsage?.flashCacheMeasuredHitTokens >= 25);
  assert.ok(healthcheckCacheUsage?.cacheMeasuredInputTokens >= 20);
  assert.ok(healthcheckCacheUsage?.cacheMeasuredHitTokens >= 5);
  assert.ok(
    adminOverview.payload?.workspaces?.some((item) => {
      if (item.id !== workspace.id) return false;
      assert.ok(item.plannerTokens >= 203);
      assert.ok(item.reviewerTokens >= 300);
      assert.ok(item.flashInputTokens >= 20);
      assert.ok(item.flashOutputTokens >= 2);
      assert.ok(item.flashCacheMeasuredInputTokens >= 20);
      assert.ok(item.flashCacheMeasuredRequests >= 1);
      assert.ok(item.flashCacheHitRequests >= 1);
      assert.ok(item.reasoningTokens >= 9);
      assert.ok(item.reasoningMeasuredRequests >= 1);
      return true;
    }),
    "admins should see project-level AI usage attributed to its planning agent",
  );
  assert.equal(adminOverview.payload?.dailyAiUsage?.length, 7);
  assert.ok(
    adminOverview.payload.dailyAiUsage.reduce((sum, day) => sum + day.totalTokens, 0) >= 606,
  );
  assert.ok(
    adminOverview.payload.dailyAiUsage.reduce((sum, day) => sum + day.reviewerRequests, 0) >= 1,
  );
  assert.ok(
    adminOverview.payload.dailyAiUsage.reduce((sum, day) => sum + day.cachedInputTokens, 0) >= 110,
  );
  assert.ok(
    adminOverview.payload.dailyAiUsage.reduce(
      (sum, day) => sum + day.cacheMeasuredInputTokens,
      0,
    ) >= 302,
  );
  assert.ok(
    adminOverview.payload.dailyAiUsage.reduce((sum, day) => sum + day.cacheMeasuredHitTokens, 0) >=
      110,
  );
  assert.ok(
    adminOverview.payload.dailyAiUsage.reduce((sum, day) => sum + day.cacheMeasuredRequests, 0) >=
      2,
  );
  assert.ok(
    adminOverview.payload.dailyAiUsage.reduce((sum, day) => sum + day.cacheHitRequests, 0) >= 2,
  );

  const promote = await request(`/api/admin/users/${outsiderId}`, {
    method: "PATCH",
    cookie: sessionCookie,
    body: { role: "admin" },
  });
  const crossOriginRoleChange = await request(`/api/admin/users/${outsiderId}`, {
    method: "PATCH",
    cookie: sessionCookie,
    headers: { Origin: "https://attacker.example" },
    body: { role: "admin" },
  });
  assert.equal(
    crossOriginRoleChange.response.status,
    403,
    "admin role changes must reject cross-origin requests",
  );
  assert.equal(promote.response.status, 200, "admins must be able to change account roles");
  const demote = await request(`/api/admin/users/${outsiderId}`, {
    method: "PATCH",
    cookie: sessionCookie,
    body: { role: "member" },
  });
  assert.equal(demote.response.status, 200, "admins must be able to restore member roles");

  const adminManagedWorkspace = {
    ...workspace,
    id: crypto.randomUUID(),
    prompt: "Admin workspace deletion smoke fixture",
  };
  const outsiderWorkspace = await request("/api/workspaces", {
    method: "POST",
    cookie: outsiderCookie,
    body: { workspace: adminManagedWorkspace },
  });
  assert.equal(outsiderWorkspace.response.status, 200);
  const adminWorkspaceDelete = await request(`/api/admin/workspaces/${adminManagedWorkspace.id}`, {
    method: "DELETE",
    cookie: sessionCookie,
  });
  assert.equal(
    adminWorkspaceDelete.response.status,
    200,
    "admins must be able to remove a workspace owned by another account",
  );
  const adminSelfRoleChange = await request(`/api/admin/users/${testUserId}`, {
    method: "PATCH",
    cookie: sessionCookie,
    body: { role: "member" },
  });
  assert.equal(adminSelfRoleChange.response.status, 400, "admins cannot remove their own role");

  const adminUserDelete = await request(`/api/admin/users/${outsiderId}`, {
    method: "DELETE",
    cookie: sessionCookie,
  });
  assert.equal(adminUserDelete.response.status, 200, "admins must be able to remove an account");
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM ai_usage WHERE user_id = ?").get(outsiderId)
      .count,
    0,
    "account deletion must also remove private AI usage records",
  );
  const deletedIdentity = await request("/api/auth/me", { cookie: outsiderCookie });
  assert.equal(deletedIdentity.payload?.user, null, "deleted accounts must lose their sessions");
  database.prepare("UPDATE users SET role = 'member' WHERE id = ?").run(testUserId);
  check(true, "Exercise admin overview, role changes, workspace removal, and account deletion");

  const crossOriginLogout = await request("/api/auth/logout", {
    method: "POST",
    cookie: sessionCookie,
    headers: { Origin: "https://attacker.example" },
  });
  assert.equal(crossOriginLogout.response.status, 403);
  const sessionAfterCrossOriginLogout = await request("/api/auth/me", { cookie: sessionCookie });
  assert.equal(sessionAfterCrossOriginLogout.payload?.user?.id, testUserId);
  check(true, "Reject a cross-origin logout without revoking the active session");

  const logout = await request("/api/auth/logout", { method: "POST", cookie: sessionCookie });
  assert.equal(logout.response.status, 200);
  const replay = await request("/api/auth/me", { cookie: sessionCookie });
  assert.equal(replay.payload?.user, null, "logout must revoke the old session token");
  const denied = await request("/api/workspaces", { cookie: sessionCookie });
  assert.equal(denied.response.status, 401);
  check(true, "Log out, revoke the session, and deny private API access");

  const oversizedLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email, password: "x".repeat(129) },
  });
  assert.equal(oversizedLogin.response.status, 400, "oversized login passwords must be rejected");
  const malformedLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email: "not-an-email", password },
  });
  assert.equal(malformedLogin.response.status, 400, "malformed login emails must be rejected");
  check(true, "Validate login input before password verification");

  const throttledEmail = `nexora-rate-limit-${crypto.randomUUID()}@example.test`;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const invalidAttempt = await request("/api/auth/login", {
      method: "POST",
      body: { email: throttledEmail, password },
    });
    assert.equal(invalidAttempt.response.status, 401);
  }
  const throttledAttempt = await request("/api/auth/login", {
    method: "POST",
    body: { email: throttledEmail, password },
  });
  assert.equal(throttledAttempt.response.status, 429);
  assert.ok(Number(throttledAttempt.response.headers.get("retry-after")) > 0);
  check(true, "Throttle repeated login attempts with a retry window");

  const login = await request("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  assert.equal(login.response.status, 200, "login with the temporary account must succeed");
  const reloginCookie = (
    login.response.headers.getSetCookie?.()[0] || login.response.headers.get("set-cookie")
  )?.split(";")[0];
  assert.ok(reloginCookie);
  const reauthenticated = await request("/api/auth/me", { cookie: reloginCookie });
  assert.equal(reauthenticated.payload?.user?.id, testUserId);
  check(true, "Log in again after session revocation");

  const invalidPasswordChange = await request("/api/auth/password", {
    method: "POST",
    cookie: reloginCookie,
    body: { currentPassword: "incorrect-current-password", newPassword: "New-password-123!" },
  });
  assert.equal(invalidPasswordChange.response.status, 403);
  const nextPassword = crypto.randomBytes(24).toString("base64url");
  const passwordChange = await request("/api/auth/password", {
    method: "POST",
    cookie: reloginCookie,
    body: { currentPassword: password, newPassword: nextPassword },
  });
  assert.equal(passwordChange.response.status, 200, "a user must be able to change their password");
  const renewedCookie = (
    passwordChange.response.headers.getSetCookie?.()[0] ||
    passwordChange.response.headers.get("set-cookie")
  )?.split(";")[0];
  assert.ok(renewedCookie, "password changes must renew the current session");
  const staleSession = await request("/api/auth/me", { cookie: reloginCookie });
  assert.equal(
    staleSession.payload?.user,
    null,
    "password changes must revoke the previous session",
  );
  const renewedIdentity = await request("/api/auth/me", { cookie: renewedCookie });
  assert.equal(renewedIdentity.payload?.user?.id, testUserId);
  const oldPasswordLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  assert.equal(oldPasswordLogin.response.status, 401, "the previous password must stop working");
  const newPasswordLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email, password: nextPassword },
  });
  assert.equal(newPasswordLogin.response.status, 200, "the new password must authenticate");
  check(true, "Change passwords securely, rotate the active session, and reject stale sessions");

  const newPasswordCookie = (
    newPasswordLogin.response.headers.getSetCookie?.()[0] ||
    newPasswordLogin.response.headers.get("set-cookie")
  )?.split(";")[0];
  assert.ok(newPasswordCookie);
  const invalidCodeRotation = await request("/api/auth/recovery-code", {
    method: "POST",
    cookie: newPasswordCookie,
    body: { currentPassword: password },
  });
  assert.equal(invalidCodeRotation.response.status, 403);
  const codeRotation = await request("/api/auth/recovery-code", {
    method: "POST",
    cookie: newPasswordCookie,
    body: { currentPassword: nextPassword },
  });
  assert.equal(codeRotation.response.status, 200);
  const rotatedRecoveryCode = codeRotation.payload?.recoveryCode;
  assert.match(rotatedRecoveryCode || "", /^[A-Za-z0-9_-]{40,}$/);
  const oldCodeRecovery = await request("/api/auth/recover", {
    method: "POST",
    body: {
      email,
      recoveryCode,
      newPassword: "Recovery-password-456!",
    },
  });
  assert.equal(
    oldCodeRecovery.response.status,
    400,
    "rotated recovery codes must invalidate the old code",
  );
  const recovery = await request("/api/auth/recover", {
    method: "POST",
    body: {
      email,
      recoveryCode: rotatedRecoveryCode,
      newPassword: "Recovery-password-456!",
    },
  });
  assert.equal(recovery.response.status, 200, "a valid recovery code must reset the password");
  assert.match(recovery.payload?.recoveryCode || "", /^[A-Za-z0-9_-]{40,}$/);
  assert.notEqual(recovery.payload.recoveryCode, rotatedRecoveryCode);
  assert.equal(recovery.payload?.user?.recoveryCodeConfigured, true);
  const recoveredCookie = (
    recovery.response.headers.getSetCookie?.()[0] || recovery.response.headers.get("set-cookie")
  )?.split(";")[0];
  assert.ok(recoveredCookie, "account recovery must establish a new authenticated session");
  const preRecoverySession = await request("/api/auth/me", { cookie: newPasswordCookie });
  assert.equal(preRecoverySession.payload?.user, null, "recovery must revoke all old sessions");
  const afterRecovery = await request("/api/auth/me", { cookie: recoveredCookie });
  assert.equal(afterRecovery.payload?.user?.id, testUserId);
  const reusedCode = await request("/api/auth/recover", {
    method: "POST",
    body: {
      email,
      recoveryCode: rotatedRecoveryCode,
      newPassword: "Another-password-789!",
    },
  });
  assert.equal(reusedCode.response.status, 400, "a recovery code must be single use");
  const recoveredPasswordLogin = await request("/api/auth/login", {
    method: "POST",
    body: { email, password: "Recovery-password-456!" },
  });
  assert.equal(recoveredPasswordLogin.response.status, 200);
  check(true, "Recover an account once, rotate its code, and revoke all previous sessions");

  const currentWorkspaceCount = database
    .prepare("SELECT COUNT(*) AS count FROM workspaces WHERE user_id = ?")
    .get(testUserId).count;
  const workspacesToFill = Math.max(0, 100 - currentWorkspaceCount);
  const insertWorkspace = database.prepare(
    "INSERT INTO workspaces (id, user_id, title, category, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const fillWorkspaceLimit = database.transaction(() => {
    for (let index = 0; index < workspacesToFill; index++) {
      const fixture = {
        ...workspace,
        id: crypto.randomUUID(),
        prompt: `Workspace capacity fixture ${index + 1}`,
      };
      insertWorkspace.run(
        fixture.id,
        testUserId,
        fixture.plan.title,
        fixture.plan.category,
        JSON.stringify(fixture),
        fixture.createdAt,
        new Date().toISOString(),
      );
    }
  });
  fillWorkspaceLimit();
  const rejectedNewWorkspace = await request("/api/workspaces", {
    method: "POST",
    cookie: recoveredCookie,
    body: { workspace: { ...workspace, id: crypto.randomUUID() } },
  });
  assert.equal(rejectedNewWorkspace.response.status, 409);
  assert.match(rejectedNewWorkspace.payload?.error || "", /最多保存 100 个/);
  const usageBeforeFullPlan = database
    .prepare("SELECT COUNT(*) AS count FROM ai_usage WHERE user_id = ?")
    .get(testUserId).count;
  const rejectedFullPlan = await request("/api/plan", {
    method: "POST",
    cookie: recoveredCookie,
    body: {
      prompt: "请为账号已满额的工作区生成新目标路线。",
      workspaceId: crypto.randomUUID(),
      demo: false,
    },
  });
  assert.equal(rejectedFullPlan.response.status, 409);
  assert.match(rejectedFullPlan.payload?.error || "", /最多保存 100 个/);
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM ai_usage WHERE user_id = ?").get(testUserId)
      .count,
    usageBeforeFullPlan,
    "a full workspace account must be rejected before an AI planning call",
  );
  const allowedWorkspaceUpdate = await request("/api/workspaces", {
    method: "POST",
    cookie: recoveredCookie,
    body: { workspace: { ...workspace, prompt: "Update is allowed at capacity" } },
  });
  assert.equal(allowedWorkspaceUpdate.response.status, 200);
  const rejectedOverflowImport = await request("/api/account/import", {
    method: "POST",
    cookie: recoveredCookie,
    body: accountExport.payload,
  });
  assert.equal(rejectedOverflowImport.response.status, 409);
  assert.match(rejectedOverflowImport.payload?.error || "", /工作空间会超过 100 个上限/);
  const capacityHistory = await request("/api/workspaces", { cookie: recoveredCookie });
  assert.equal(capacityHistory.payload?.workspaces?.length, 100);
  const capacityKnowledge = await request("/api/knowledge", { cookie: recoveredCookie });
  assert.equal(capacityKnowledge.payload?.documents?.length, 2);
  check(
    true,
    "Enforce the 100-workspace limit before AI spend without blocking updates or partial imports",
  );
} catch (error) {
  if (
    !(error instanceof Error) ||
    !["SmokeServerUnavailableError", "SmokeDatabaseMismatchError"].includes(error.name)
  )
    throw error;
  console.error(error.message);
  smokeServerUnavailable = true;
} finally {
  rateLimitDatabase?.close();
  if (testUserIds.length) {
    database ||= new Database(resolveDatabasePath(), {
      timeout: 10_000,
    });
    database.transaction(() => {
      for (const id of testUserIds) {
        database.prepare("DELETE FROM ai_usage WHERE user_id = ?").run(id);
        database.prepare("DELETE FROM knowledge_documents WHERE user_id = ?").run(id);
        database.prepare("DELETE FROM workspaces WHERE user_id = ?").run(id);
        database.prepare("DELETE FROM users WHERE id = ?").run(id);
      }
    })();
  }
  database?.close();
}

if (smokeServerUnavailable) {
  process.exitCode = 1;
} else {
  for (const checkpoint of checkpoints) console.log(`✓ ${checkpoint}`);
  console.log(`NEXORA smoke check passed (${checkpoints.length} checkpoints).`);
}
