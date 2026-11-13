const progressSignals =
  /(?:到哪(?:里|儿)?(?:一步)?|做到哪|做到什么程度|进度|当前状态|目前状态|当前做什么|现在做什么|完成情况|完成了多少|已完成多少|完成了吗|有没有完成|做完了吗|做完了(?:没有|没)?|做了什么|做了啥|做了哪些|正在做什么|现在在做什么|在干什么|还在(?:后台)?(?:运行|工作|做))/u;

const actionableSignals =
  /(?:帮我|替我|继续|开始|执行|生成|编写|写代码|修复|修改|创建|开发|实现|制作|搜索|查找|导出|下载|交付|推进|补充|完善|优化|处理|新增|添加|增加|再加|顺便.{0,12}(?:做|写|改|加|生成|修)|马上|立刻|把.{0,20}(?:改|补|做|写|修|生成|完成))/u;

const mixedRequestSignals =
  /(?:然后|顺便|另外|此外|并且|同时|下一步|下一阶段|还需要(?:做|完成)|风险|原因|为什么|建议|帮我分析|总结一下)/u;

export function isWorkspaceProgressQuestion(question) {
  const text = typeof question === "string" ? question.trim() : "";
  return Boolean(
    text &&
    progressSignals.test(text) &&
    !actionableSignals.test(text) &&
    !mixedRequestSignals.test(text),
  );
}

function taskLines(tasks) {
  const normalized = Array.isArray(tasks)
    ? tasks.filter((task) => task && typeof task.title === "string")
    : [];
  const completed = normalized.filter((task) => task.status === "done").length;
  const remaining = normalized.filter((task) => task.status !== "done");
  const lines = [
    "已保存任务：" +
      completed +
      "/" +
      normalized.length +
      " 项完成，" +
      remaining.length +
      " 项待推进。",
  ];
  if (remaining.length) {
    const titles = remaining
      .slice(0, 5)
      .map((task) => task.title.trim())
      .filter(Boolean);
    if (titles.length)
      lines.push("待推进：" + titles.join("；") + (remaining.length > 5 ? "；还有其他任务" : ""));
  }
  return lines;
}

function savedArtifacts(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return "";
  const titles = artifacts
    .slice(-5)
    .map((artifact) => artifact?.title)
    .filter((title) => typeof title === "string" && title.trim())
    .map((title) => title.trim());
  return titles.length ? "最近保存的成果：" + titles.join("；") : "";
}

export function buildWorkspaceProgressAnswer(context) {
  const tasks = taskLines(context.tasks);
  const artifacts = savedArtifacts(context.artifacts);
  const savedSummary =
    typeof context.resultSummary === "string" && context.resultSummary.trim()
      ? context.resultSummary.trim()
      : "没有已保存的执行摘要。";

  if (context.executionIsRunning) {
    const activity = context.currentActivity?.trim() || "正在处理当前步骤";
    const toolCalls = Math.max(0, Math.floor(Number(context.completedToolCalls) || 0));
    return [
      "这个工作区正在后台运行。当前步骤：" + activity + "。",
      "已记录 " + toolCalls + " 次工具操作；这是活动记录，不代表项目完成百分比。",
      ...tasks,
      artifacts ? "此前保存的成果：" + artifacts.slice("最近保存的成果：".length) : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (context.globalExecution) {
    const otherTitle = context.globalExecution.workspaceTitle?.trim() || "另一个工作区";
    const otherActivity = context.globalExecution.activity?.trim() || "正在执行当前步骤";
    return [
      "这个工作区当前没有后台任务。Agent 正在「" + otherTitle + "」中运行：" + otherActivity + "。",
      context.executionWasInterrupted
        ? "当前工作区上次执行已中断：" +
          (context.latestExecutionMessage?.trim() ||
            context.latestExecutionActivity?.trim() ||
            "上轮执行已停止")
        : "",
      "当前工作区最近一次已保存结果：" + savedSummary,
      ...tasks,
      artifacts,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (context.executionWasInterrupted) {
    const reason =
      context.latestExecutionMessage?.trim() ||
      context.latestExecutionActivity?.trim() ||
      "上轮执行已停止";
    return [
      "上轮执行已中断，当前没有任务在后台运行。记录：" + reason,
      "最近一次已保存结果：" + savedSummary,
      ...tasks,
      artifacts,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  const executionState =
    context.latestExecutionState === "completed"
      ? "最近一次执行已完成。"
      : "当前没有任务在后台运行。";
  return [executionState, "最近一次已保存结果：" + savedSummary, ...tasks, artifacts]
    .filter(Boolean)
    .join("\n\n");
}
