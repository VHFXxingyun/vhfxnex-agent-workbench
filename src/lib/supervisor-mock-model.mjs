import { MockLanguageModelV3 } from "ai/test";

const mockUsage = {
  inputTokens: { total: 120, noCache: 120, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 24, text: 24, reasoning: 0 },
};

function textResponse(chunks) {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "assistant-text" },
    ...chunks.map((delta) => ({ type: "text-delta", id: "assistant-text", delta })),
    { type: "text-end", id: "assistant-text" },
    { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: mockUsage },
  ];
}

function toolResponse(toolName, input) {
  const id = `call-${toolName}`;
  const serialized = JSON.stringify(input);
  return [
    { type: "stream-start", warnings: [] },
    { type: "tool-input-start", id, toolName },
    { type: "tool-input-delta", id, delta: serialized },
    { type: "tool-input-end", id },
    { type: "tool-call", toolCallId: id, toolName, input: serialized },
    {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
      usage: mockUsage,
    },
  ];
}

function responsesFor(scenario, workspaceId, directToolId) {
  if (scenario === "reply") return [textResponse(["模拟模型已通过管理员 API ", "流式回复。"])];
  if (scenario === "handoff" || scenario === "handoff-unauthorized") {
    return [
      toolResponse("handoff_to_workbench", {
        workspaceId,
        instruction: "模拟模型通过管理员发起的工作台交接。",
      }),
    ];
  }
  if (scenario === "open-user-tool") {
    return [
      toolResponse("open_user_tool", {
        tool: directToolId,
        instruction: `通过模拟模型打开 ${directToolId} 工具。`,
      }),
    ];
  }
  if (scenario === "new-goal") {
    return [toolResponse("start_new_goal", { prompt: "创建一个模拟回归新目标" })];
  }
  if (scenario === "search") {
    return [
      toolResponse("search_web", { query: "模拟管理员搜索" }),
      textResponse(["模拟搜索完成，来源：https://example.test/supervisor-search。"]),
    ];
  }
  throw new Error("未知的管理员模拟场景。");
}

/** Test-only LanguageModelV3; never connects to an external provider. */
export function createSupervisorMockModel(scenario, workspaceId = "", directToolId = "pdf") {
  const responses = responsesFor(scenario, workspaceId, directToolId);
  let callIndex = 0;
  return new MockLanguageModelV3({
    provider: "vhfxnex-test",
    modelId: "supervisor-mock",
    doStream: async () => {
      const parts = responses[Math.min(callIndex, responses.length - 1)];
      callIndex += 1;
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      };
    },
  });
}
