import assert from "node:assert/strict";
import fs from "node:fs";
import { streamText, tool } from "ai";
import { z } from "zod";
import { consumeSupervisorModelStream } from "../src/lib/supervisor-model-stream.mjs";
import { createSupervisorMockModel } from "../src/lib/supervisor-mock-model.mjs";

const workspaceId = "51e0e674-9e35-4a9b-a2e5-e13bff6846ab";
let searchExecutionCount = 0;
const schemas = {
  handoff: z.object({
    workspaceId: z.string().uuid(),
    instruction: z.string().trim().min(1).max(4_000),
  }),
  userTool: z.object({
    tool: z.enum(["documents", "pdf", "code", "spreadsheet", "json", "presentation", "search"]),
    instruction: z.string().trim().min(1),
  }),
  newGoal: z.object({ prompt: z.string().trim().min(6) }),
};
const tools = {
  handoff_to_workbench: tool({ description: "交给当前工作区执行", inputSchema: schemas.handoff }),
  open_user_tool: tool({ description: "打开用户直用工具", inputSchema: schemas.userTool }),
  start_new_goal: tool({ description: "创建一个不同的新目标", inputSchema: schemas.newGoal }),
  search_web: tool({
    description: "搜索公开网页",
    inputSchema: z.object({ query: z.string().min(2) }),
    execute: async ({ query }) => {
      searchExecutionCount += 1;
      return {
        query,
        sources: [{ title: "模拟来源", url: "https://example.test/source", snippet: "测试摘要" }],
      };
    },
  }),
};

async function collect(scenario, modelWorkspaceId = workspaceId) {
  const result = streamText({
    model: createSupervisorMockModel(scenario, modelWorkspaceId),
    prompt: "模拟用户指令",
    tools,
    stopWhen: ({ steps }) => steps.length >= 2,
  });
  const events = [];
  const consumed = await consumeSupervisorModelStream({
    fullStream: result.fullStream,
    signal: new AbortController().signal,
    isCancelled: () => false,
    send: (event) => {
      events.push(event);
      return true;
    },
    schemas,
  });
  return { consumed, events, steps: await result.steps };
}

const routeSource = fs.readFileSync(
  new URL("../src/app/api/chat/route.ts", import.meta.url),
  "utf8",
);
assert.match(routeSource, /consumeSupervisorModelStream/u);
assert.match(routeSource, /createSupervisorMockModel/u);
assert.match(
  routeSource,
  /handoffFallback:\s*\{\s*workspaceId:\s*workspace\.id,\s*instruction:\s*question\s*\}/u,
);
assert.match(routeSource, /handoffFallback:\s*args\.handoffFallback/u);

const reply = await collect("reply");
assert.equal(reply.consumed.answer, "模拟模型已通过管理员 API 流式回复。");
assert.deepEqual(
  reply.events.filter((event) => event.type === "text").map((event) => event.text),
  ["模拟模型已通过管理员 API ", "流式回复。"],
);

const handoffInstruction = "模拟模型通过管理员发起的工作台交接。";
const handoff = await collect("handoff");
assert.deepEqual(handoff.consumed.handoff, { workspaceId, instruction: handoffInstruction });
assert.equal(handoff.consumed.answer, "");

const directTool = await collect("open-user-tool");
assert.deepEqual(directTool.consumed.userToolLaunch, {
  tool: "pdf",
  instruction: "通过模拟模型打开 pdf 工具。",
});

const newGoal = await collect("new-goal");
assert.deepEqual(newGoal.consumed.newGoalLaunch, { prompt: "创建一个模拟回归新目标" });

const search = await collect("search");
assert.equal(search.steps.length, 2, "search should execute once and then return a final answer");
assert.equal(searchExecutionCount, 1, "mock search tool should execute exactly once");
assert.match(search.consumed.answer, /example\.test\/supervisor-search/u);
assert.deepEqual(
  search.events.filter((event) => event.type === "status").map((event) => event.message),
  ["正在联网检索公开来源…", "已收到网页来源，正在整理结论…"],
);

await assert.rejects(
  () =>
    consumeSupervisorModelStream({
      fullStream: (async function* () {
        yield {
          type: "tool-call",
          toolName: "handoff_to_workbench",
          input: { instruction: "缺少目标工作区" },
        };
      })(),
      signal: new AbortController().signal,
      isCancelled: () => false,
      send: () => true,
      schemas,
    }),
  /没有选定有效工作区/u,
);

const fallbackEvents = [];
const fallbackHandoff = await consumeSupervisorModelStream({
  fullStream: (async function* () {
    yield {
      type: "tool-call",
      toolName: "handoff_to_workbench",
      input: { workspaceId, instruction: "x".repeat(4_001) },
    };
  })(),
  signal: new AbortController().signal,
  isCancelled: () => false,
  send: (event) => {
    fallbackEvents.push(event);
    return true;
  },
  handoffFallback: { workspaceId, instruction: "请按附件要求完成这项工作。" },
  schemas,
});
assert.deepEqual(fallbackHandoff.handoff, {
  workspaceId,
  instruction: "请按附件要求完成这项工作。",
});
assert.match(
  fallbackEvents.find((event) => event.type === "status")?.message || "",
  /按当前工作区和你的原始要求继续交接/u,
);

const wrongWorkspaceFallback = await consumeSupervisorModelStream({
  fullStream: (async function* () {
    yield {
      type: "tool-call",
      toolName: "handoff_to_workbench",
      input: {
        workspaceId: "b699faef-319f-4470-9865-5850cce12276",
        instruction: "请推进当前需求。",
      },
    };
  })(),
  signal: new AbortController().signal,
  isCancelled: () => false,
  send: (event) => {
    fallbackEvents.push(event);
    return true;
  },
  handoffFallback: { workspaceId, instruction: "请按附件要求完成这项工作。" },
  schemas,
});
assert.deepEqual(wrongWorkspaceFallback.handoff, {
  workspaceId,
  instruction: "请按附件要求完成这项工作。",
});
assert.match(fallbackEvents.at(-1)?.message || "", /交接目标与当前工作区不一致/u);

const aborted = new AbortController();
aborted.abort();
await assert.rejects(
  () =>
    consumeSupervisorModelStream({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "不应发送" };
      })(),
      signal: aborted.signal,
      isCancelled: () => false,
      send: () => true,
      schemas,
    }),
  { name: "AbortError" },
);

console.log(
  "✓ Supervisor mock-model flow covers streamed replies, web search, tool opening, new goals, handoff parsing, invalid calls, and cancellation without network/API access.",
);
