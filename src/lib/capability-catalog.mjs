import { agentToolCatalog } from "./agent-tool-catalog.mjs";

export const userDirectToolCatalog = Object.freeze([
  Object.freeze({
    id: "documents",
    name: "文档工作台",
    description: "导入、编辑并导出 Markdown、Word 与 PDF。",
  }),
  Object.freeze({
    id: "pdf",
    name: "PDF 工具箱",
    description: "在本机合并 PDF、调整文件顺序并提取指定页面。",
  }),
  Object.freeze({
    id: "code",
    name: "代码工坊",
    description: "编辑项目源码、查看隔离预览、静态检查并下载 ZIP。",
  }),
  Object.freeze({
    id: "spreadsheet",
    name: "表格工作台",
    description: "编辑 CSV/Excel 工作簿并导出表格。",
  }),
  Object.freeze({
    id: "presentation",
    name: "演示稿工坊",
    description: "逐页编辑幻灯片、备注并导出 PowerPoint。",
  }),
  Object.freeze({
    id: "json",
    name: "JSON 工坊",
    description: "在本机校验、格式化、压缩 JSON。",
  }),
  Object.freeze({
    id: "search",
    name: "联网搜索",
    description: "直接查找公开网页并查看来源摘要。",
  }),
]);

export const userDirectToolIds = Object.freeze(userDirectToolCatalog.map(({ id }) => id));

export const specialistAgentCatalog = Object.freeze([
  Object.freeze({ name: "规划 Agent", description: "把新目标拆成路线、阶段和行动计划。" }),
  Object.freeze({
    name: "工作台 Agent",
    description: "持续执行选定工作区的任务，并调用专用工具产出文件或源码。",
  }),
  Object.freeze({
    name: "复核 Agent",
    description: "在适用的代码交付中检查项目结构、入口与交付要求。",
  }),
]);

const CAPABILITY_QUESTION =
  /(?:有哪些|有什么|可以用哪些|能用哪些|支持哪些|能调用哪些|列出)(?:直接使用的)?(?:工具|功能|能力|Agent|智能体)|(?:工具|功能|能力|Agent|智能体)(?:列表|清单|目录)|(?:你能做什么|你可以做什么|能帮我做什么)/u;

/** Answer capability-list questions without paying for a model routing turn. */
export function buildCapabilityCatalogAnswer(message) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text || text.length > 180 || !CAPABILITY_QUESTION.test(text)) return null;

  const userTools = userDirectToolCatalog
    .map((tool) => `- ${tool.name}：${tool.description}`)
    .join("\n");
  const agentTools = agentToolCatalog
    .map((group) => `- ${group.title}：${group.description}`)
    .join("\n");
  const agents = specialistAgentCatalog
    .map((agent) => `- ${agent.name}：${agent.description}`)
    .join("\n");

  return [
    "我作为 VHFXNEX 管理员 Agent 负责和你交流、判断任务归属，并在你的账号权限内调度规划、执行与复核。",
    "你可以直接使用的工具（编辑、预览和导出通常在本机完成）：",
    userTools,
    "工作台 Agent 可调用的执行工具：",
    agentTools,
    "协作 Agent：",
    agents,
    "你可以让我直接讨论或查进度；让我实际完成任务时，我会交给对应工作区和专用 Agent 连续处理。",
  ].join("\n\n");
}
