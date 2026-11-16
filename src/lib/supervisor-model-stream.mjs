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

function parseHandoffInput(schema, input, fallback, send) {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    if (fallback && parsed.data.workspaceId && parsed.data.workspaceId !== fallback.workspaceId) {
      if (
        !send({
          type: "status",
          message: "交接目标与当前工作区不一致，已按当前工作区和你的原始要求继续交接。",
        })
      )
        throw new DOMException("请求已取消", "AbortError");
      return fallback;
    }
    return parsed.data;
  }

  if (fallback) {
    if (
      !send({
        type: "status",
        message: "交接参数格式异常，已按当前工作区和你的原始要求继续交接。",
      })
    )
      throw new DOMException("请求已取消", "AbortError");
    return fallback;
  }

  const invalidFields = new Set(parsed.error.issues.map((issue) => issue.path[0]));
  if (invalidFields.has("workspaceId"))
    throw new Error("交接未创建：对话 Agent 没有选定有效工作区。请先选择目标工作区后重试。");
  if (invalidFields.has("instruction"))
    throw new Error(
      "交接未创建：对话 Agent 没有生成有效执行指令。请重试或在目标工作区直接发送要求。",
    );
  throw new Error("交接未创建：对话 Agent 返回的信息格式不完整，请重试。");
}

/** Consume the public text/tool events emitted by the supervisor model. */
export async function consumeSupervisorModelStream({
  fullStream,
  signal,
  isCancelled,
  send,
  schemas,
  handoffFallback = null,
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
      handoff = parseHandoffInput(schemas.handoff, part.input, handoffFallback, send);
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
