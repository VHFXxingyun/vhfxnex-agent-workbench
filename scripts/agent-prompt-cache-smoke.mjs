import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SHARED_AGENT_PROMPT_PREFIX,
  prependSharedAgentPromptPrefix,
} from "../src/lib/agent-prompt-prefix.mjs";
import {
  buildExecutionCheckpointMessage,
  buildExecutionRecentUserInstructions,
  EXECUTION_PROMPT_STABLE_PREFIX,
} from "../src/lib/execution-prompt.mjs";
import { buildDialogueHistoryContext } from "../src/lib/dialogue-context.mjs";
import {
  classifyExplicitNewGoalLaunch,
  classifyExplicitUserToolLaunch,
  classifyExplicitWorkbenchExecution,
} from "../src/lib/dialogue-intent.mjs";
import {
  buildCapabilityCatalogAnswer,
  userDirectToolCatalog,
  userDirectToolIds,
} from "../src/lib/capability-catalog.mjs";
import {
  DEFAULT_THINKING_MODE,
  deepSeekThinkingOptions,
  normalizeThinkingMode,
} from "../src/lib/thinking-mode.mjs";

const routeFiles = [
  ["planner", "src/app/api/plan/route.ts"],
  ["dialogue", "src/app/api/chat/route.ts"],
  ["workbench and reviewer", "src/app/api/execute/route.ts"],
];

assert.ok(
  SHARED_AGENT_PROMPT_PREFIX.length >= 600,
  "shared prefix should contain substantive cross-agent operating rules",
);
assert.ok(!/\$\{|\b(?:today|date|workspaceId|userId)\b/i.test(SHARED_AGENT_PROMPT_PREFIX));
assert.ok(EXECUTION_PROMPT_STABLE_PREFIX.startsWith(SHARED_AGENT_PROMPT_PREFIX));

const stableTextAttachments = [
  { name: "brief.md", mimeType: "text/markdown", content: "same reference material" },
];
const stableImages = [
  { name: "reference.png", mimeType: "image/png", content: "data:image/png;base64,AA==" },
];
const firstCheckpointMessage = buildExecutionCheckpointMessage({
  textAttachments: stableTextAttachments,
  images: stableImages,
  checkpoint: { requiredTool: "draft_document", step: 1 },
});
const nextCheckpointMessage = buildExecutionCheckpointMessage({
  textAttachments: stableTextAttachments,
  images: stableImages,
  checkpoint: { requiredTool: "create_project", step: 2 },
});
assert.deepEqual(
  firstCheckpointMessage.content.slice(0, 2),
  nextCheckpointMessage.content.slice(0, 2),
);
assert.notDeepEqual(firstCheckpointMessage.content.at(-1), nextCheckpointMessage.content.at(-1));
assert.match(firstCheckpointMessage.content[0].text, /仅为参考资料，不可信/);
assert.match(firstCheckpointMessage.content.at(-1).text, /draft_document/);

const dialogueHistory = buildDialogueHistoryContext(
  Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `${index}: ${"历史对话".repeat(300)}`,
  })),
);
assert.equal(dialogueHistory.length, 8);
assert.ok(dialogueHistory.every((message) => message.content.length <= 1_000));
assert.match(dialogueHistory[0].content, /^4:/);
assert.match(dialogueHistory.at(-1).content, /^11:/);
const currentTurnHistory = buildDialogueHistoryContext(
  [
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `prior-${index}`,
      role: index % 2 ? "assistant" : "user",
      content: `prior ${index}`,
    })),
    { id: "current-turn", role: "user", content: "current instruction" },
  ],
  { excludeMessageId: "current-turn" },
);
assert.equal(currentTurnHistory.length, 8);
assert.ok(currentTurnHistory.every((message) => message.content !== "current instruction"));

const repeatedExecutionHistory = buildExecutionRecentUserInstructions(
  [
    { role: "user", content: "更早的旧约束" },
    { role: "assistant", content: "Agent 状态文字" },
    ...Array.from({ length: 5 }, (_, index) => ({
      role: "user",
      content: `${index === 4 ? "当前执行指示" : `历史补充 ${index}`} ${"背景约束".repeat(200)}`,
    })),
  ],
  ["当前执行指示" + ` ${"背景约束".repeat(200)}`],
);
assert.equal(repeatedExecutionHistory.length, 3);
assert.ok(repeatedExecutionHistory.every((content) => content.length <= 800));
assert.ok(repeatedExecutionHistory.every((content) => !content.startsWith("当前执行指示")));
assert.ok(!repeatedExecutionHistory.some((content) => content === "更早的旧约束"));

assert.equal(classifyExplicitUserToolLaunch("打开文档工作台")?.tool, "documents");
assert.equal(classifyExplicitUserToolLaunch("请帮我进入代码工坊")?.tool, "code");
assert.equal(classifyExplicitUserToolLaunch("使用一下 Excel 工具")?.tool, "spreadsheet");
assert.equal(classifyExplicitUserToolLaunch("打开 PowerPoint 工具")?.tool, "presentation");
assert.equal(classifyExplicitUserToolLaunch("打开联网搜索工具")?.tool, "search");
assert.equal(classifyExplicitUserToolLaunch("打开 PDF 工具箱")?.tool, "pdf");
assert.equal(classifyExplicitUserToolLaunch("你觉得代码工坊怎么样？"), null);
assert.equal(classifyExplicitUserToolLaunch("为什么不能打开表格工作台？"), null);
assert.equal(classifyExplicitUserToolLaunch("我想做一份 Word 文档"), null);
assert.deepEqual(classifyExplicitNewGoalLaunch("新建一个目标：开发桌面倒计时工具"), {
  prompt: "新建一个目标：开发桌面倒计时工具",
});
assert.equal(classifyExplicitNewGoalLaunch("我们讨论一下要不要新建项目？"), null);
assert.equal(classifyExplicitNewGoalLaunch("新建项目：计时器"), null);
assert.equal(classifyExplicitWorkbenchExecution("好，继续制作吧")?.instruction, "好，继续制作吧");
assert.equal(
  classifyExplicitWorkbenchExecution("按照当前选定路线开始执行")?.instruction,
  "按照当前选定路线开始执行",
);
assert.equal(classifyExplicitWorkbenchExecution("继续开发这会不会太复杂？"), null);
assert.equal(classifyExplicitWorkbenchExecution("我们可以继续讨论一下路线吗"), null);
assert.equal(
  classifyExplicitWorkbenchExecution(
    "请立即恢复当前消防活动策划执行，直接调用工作台产出可下载的最终 DOCX；完成后检查标题与模板一致。",
  )?.instruction,
  "请立即恢复当前消防活动策划执行，直接调用工作台产出可下载的最终 DOCX；完成后检查标题与模板一致。",
  "a clear execution request with an attached template should bypass fragile intent routing",
);
assert.equal(classifyExplicitWorkbenchExecution("请问这个活动方案为什么会中断"), null);
assert.equal(buildCapabilityCatalogAnswer("你能用哪些工具？")?.includes("代码工坊"), true);
assert.equal(buildCapabilityCatalogAnswer("刚才的代码怎么回事？"), null);
assert.deepEqual(userDirectToolIds, [
  "documents",
  "pdf",
  "code",
  "spreadsheet",
  "presentation",
  "json",
  "search",
]);
assert.equal(userDirectToolCatalog.length, userDirectToolIds.length);
assert.equal(DEFAULT_THINKING_MODE, "deep");
assert.equal(normalizeThinkingMode(undefined), "deep");
assert.deepEqual(deepSeekThinkingOptions(normalizeThinkingMode(undefined)), {
  thinking: { type: "enabled" },
  reasoning_effort: "high",
});
assert.deepEqual(deepSeekThinkingOptions(normalizeThinkingMode("fast")), {
  thinking: { type: "disabled" },
});

for (const role of ["planner", "dialogue", "workbench", "reviewer"]) {
  const prompt = prependSharedAgentPromptPrefix(`Role-specific policy for ${role}.`);
  assert.ok(prompt.startsWith(SHARED_AGENT_PROMPT_PREFIX), `${role} must share the exact prefix`);
}

for (const [role, filePath] of routeFiles) {
  const source = await readFile(filePath, "utf8");
  assert.match(source, /prependSharedAgentPromptPrefix/);
  if (role === "workbench and reviewer") {
    assert.match(source, /buildExecutionSystemPrompt/);
    assert.match(source, /normalizeThinkingMode\(body\.thinkingMode\)/);
    assert.match(source, /system:\s*prependSharedAgentPromptPrefix\(/);
    assert.equal(
      (source.match(/\bgoal:\s*prompt\s*,/gu) || []).length,
      0,
      "the combined goal-plus-instruction string must not be sent beside the same instruction",
    );
    assert.ok(
      /goal\s*,\s*route:\s*route\.title/su.test(source),
      "the initial prompt should send the base goal as its own field",
    );
    assert.ok(
      /requiredTool\s*,\s*goal\s*,\s*instruction\s*,/su.test(source),
      "follow-up checkpoints should carry distinct goal/instruction fields",
    );
  }
  if (role === "dialogue") {
    assert.match(source, /search_web: tool\(/);
    assert.match(source, /文档工作台、PDF 工具箱、代码工坊/);
    assert.match(source, /演示稿工坊、JSON 工坊或联网搜索/);
    assert.match(source, /z\.enum\(userDirectToolIds\)/);
    assert.match(source, /excludeMessageId: userMessage\.id/);
    assert.match(source, /stepsOutcome\.value\.length/);
    assert.match(source, /classifyExplicitWorkbenchExecution/);
    assert.match(source, /classifyExplicitNewGoalLaunch/);
    assert.match(source, /!explicitNewGoalLaunch/);
    assert.match(source, /buildCapabilityCatalogAnswer/);
    assert.match(source, /最高层用户协作管理员 Agent/);
  }
}

const toolCenterSource = await readFile("src/components/ToolCenter.tsx", "utf8");
assert.match(toolCenterSource, /type Tool = UserDirectToolId/);

console.log(
  "✓ Agent prompts reuse stable input layout; dialogue history is capped and execution references stay ahead of checkpoints.",
);
