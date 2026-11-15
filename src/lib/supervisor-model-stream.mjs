function throwIfStopped(signal, isCancelled) {
  if (signal.aborted || isCancelled()) {
    throw new DOMException("请求已取消", "AbortError");
  }
}

function parseToolInput(schema, input, message) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error(message);
  return parsed.data;
}

/** Consume the public text/tool events emitted by the supervisor model. */
export async function consumeSupervisorModelStream({
  fullStream,
  signal,
  isCancelled,
  send,
  schemas,
}) {
  let answer = "";
  let handoff = null;
  let userToolLaunch = null;
  let newGoalLaunch = null;

  for await (const part of fullStream) {
    throwIfStopped(signal, isCancelled);
    if (part.type === "text-delta" && typeof part.text === "string") {
      answer += part.text;
      if (!send({ type: "text", text: part.text })) {
        throw new DOMException("请求已取消", "AbortError");
      }
    } else if (part.type === "tool-call" && part.toolName === "handoff_to_workbench") {
      handoff = parseToolInput(
        schemas.handoff,
        part.input,
        "对话 Agent 生成的工作交接信息无效，请重试。",
      );
    } else if (part.type === "tool-call" && part.toolName === "open_user_tool") {
      userToolLaunch = parseToolInput(
        schemas.userTool,
        part.input,
        "总控 Agent 生成的工具分流信息无效，请重试。",
      );
    } else if (part.type === "tool-call" && part.toolName === "start_new_goal") {
      newGoalLaunch = parseToolInput(
        schemas.newGoal,
        part.input,
        "总控 Agent 生成的新目标信息无效，请重试。",
      );
    } else if (part.type === "tool-call" && part.toolName === "search_web") {
      send({ type: "status", message: "正在联网检索公开来源…" });
    } else if (part.type === "tool-result" && part.toolName === "search_web") {
      send({ type: "status", message: "已收到网页来源，正在整理结论…" });
    } else if (part.type === "error") {
      throw part.error;
    }
  }

  throwIfStopped(signal, isCancelled);
  return { answer, handoff, userToolLaunch, newGoalLaunch };
}
