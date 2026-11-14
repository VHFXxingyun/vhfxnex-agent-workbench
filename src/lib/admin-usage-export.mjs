import { estimateDeepSeekFlashCost, isDeepSeekFlashModel } from "./deepseek-cost-estimate.mjs";

const sourceLabels = {
  planner: "规划 Agent",
  dialogue: "对话 Agent",
  workbench: "工作台 Agent",
  reviewer: "代码复核 Agent",
  healthcheck: "连接诊断",
  unknown: "历史 / 未分类",
};

function clampCount(value) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function csvCell(value) {
  const raw = String(value ?? "");
  const safe = typeof value === "string" && /^[\u0000-\u0020]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .format(date)
    .replace(" ", "T");
}

function formatCost(value) {
  return Number.isFinite(value) ? value.toFixed(10) : "";
}

/** Build an Excel-friendly report for the app's latest AI usage records only. */
export function createAdminUsageCsv(items) {
  const rows = [
    [
      "时间（北京时间）",
      "工作区",
      "Agent 来源",
      "模型",
      "操作",
      "输入 Token",
      "输出 Token",
      "思考 Token（输出内）",
      "缓存统计输入 Token",
      "缓存命中 Token",
      "缓存未命中 Token",
      "请求缓存状态",
      "缓存统计覆盖率",
      "耗时（ms）",
      "Flash 当前价估值下限（USD）",
      "Flash 当前价估值上限（USD）",
    ],
    ...items.map((item) => {
      const inputTokens = clampCount(item.inputTokens);
      const outputTokens = clampCount(item.outputTokens);
      const measuredInputTokens = Math.min(inputTokens, clampCount(item.cacheMeasuredInputTokens));
      const hitTokens = Math.min(measuredInputTokens, clampCount(item.cacheMeasuredHitTokens));
      const missTokens = measuredInputTokens - hitTokens;
      const sourceLabel = Object.hasOwn(sourceLabels, item.source)
        ? sourceLabels[item.source]
        : item.source || "未知来源";
      const flashEstimate = isDeepSeekFlashModel(item.model)
        ? estimateDeepSeekFlashCost({
            inputTokens,
            outputTokens,
            cacheMeasuredInputTokens: measuredInputTokens,
            cacheMeasuredHitTokens: hitTokens,
          })
        : null;
      return [
        formatTimestamp(item.createdAt),
        item.workspaceTitle || "未关联工作区",
        sourceLabel,
        item.model || "未知模型",
        item.operation === "plan" ? "规划" : "执行",
        inputTokens,
        outputTokens,
        clampCount(item.reasoningTokens),
        measuredInputTokens,
        hitTokens,
        missTokens,
        measuredInputTokens > 0 ? (hitTokens > 0 ? "已命中" : "无命中") : "暂无样本",
        inputTokens > 0 ? `${((measuredInputTokens / inputTokens) * 100).toFixed(1)}%` : "暂无样本",
        clampCount(item.latencyMs),
        flashEstimate ? formatCost(flashEstimate.lowerUsd) : "",
        flashEstimate ? formatCost(flashEstimate.upperUsd) : "",
      ];
    }),
  ];

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
