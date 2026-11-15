const OPEN_COMMAND = /^(?:请|麻烦)?(?:帮我)?(?:打开|进入|启动|使用)(?:一下)?/u;
const COMMAND_BOUNDARY = /(?=$|[\s，,。！？!?])/u;

const DIRECT_TOOL_TARGETS = [
  { pattern: /(?:文档工作台|文档工具)/u, tool: "documents", label: "文档工作台" },
  { pattern: /(?:PDF\s*(?:工具箱|工具|合并|拆分))/iu, tool: "pdf", label: "PDF 工具箱" },
  {
    pattern: /(?:演示稿工坊|PowerPoint(?:\s*工具)?|PPT(?:\s*工具)?|幻灯片工具)/iu,
    tool: "presentation",
    label: "演示稿工坊",
  },
  { pattern: /(?:代码工坊|代码工具)/u, tool: "code", label: "代码工坊" },
  { pattern: /(?:JSON\s*(?:工坊|工具|工作台))/iu, tool: "json", label: "JSON 工坊" },
  {
    pattern: /(?:表格工作台|表格工具|电子表格工具|Excel\s*工具)/iu,
    tool: "spreadsheet",
    label: "表格工作台",
  },
  {
    pattern: /(?:联网搜索工具|搜索工作台|网页搜索工具|资料搜索工具)/u,
    tool: "search",
    label: "联网搜索工具",
  },
];

/** Route only unmistakable tool-opening commands, leaving discussion to the supervisor model. */
export function classifyExplicitUserToolLaunch(message) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text || !OPEN_COMMAND.test(text)) return null;
  const target = DIRECT_TOOL_TARGETS.find((item) => {
    const match = text.match(item.pattern);
    return Boolean(match && COMMAND_BOUNDARY.test(text.slice(match.index + match[0].length)));
  });
  return target ? { tool: target.tool, instruction: text.slice(0, 1200) } : null;
}

/**
 * Skip the supervisor routing call when the user unmistakably starts a new
 * goal. The planner still runs normally; this only removes a redundant
 * intent-classification request in front of it.
 */
export function classifyExplicitNewGoalLaunch(message) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text || text.length > 4_000 || /[?？]/u.test(text)) return null;
  const match = text.match(
    /^(?:(?:请|麻烦)?(?:帮我)?(?:新建|创建|启动)(?:一个)?(?:新)?(?:目标|项目)|开始新目标)(?:\s*[：:，,]\s*|\s+)(.{6,})$/u,
  );
  return match ? { prompt: text } : null;
}

/**
 * Skip the dialogue model only for unmistakable "start/continue the selected
 * route" commands in an already selected workspace. Questions and discussion
 * remain with the dialogue agent.
 */
export function classifyExplicitWorkbenchExecution(message) {
  const text = typeof message === "string" ? message.trim() : "";
  if (
    !text ||
    text.length > 360 ||
    /[?？]|(?:吗|么|是否|好不好|值不值得|该不该|能不能|可不可以)\s*[。！!]?$/u.test(text)
  )
    return null;

  const command = text.replace(/^(?:(?:好的?|那就|现在|接着|请|麻烦)[，,\s]*)+/u, "");
  const explicitCommand =
    /^(?:(?:就)?按(?:照)?(?:(?:当前)?(?:已选|选定)(?:的)?|我选的|推荐的?|刚才的|这个|此|当前)?(?:路线|方案|计划)(?:直接)?(?:(?:开始|继续)(?:执行|推进|制作|开发|实现|做)?|执行|推进|制作|开发|实现)(?:吧|即可|下去)?[。！!]?)$/u.test(
      command,
    ) ||
    /^(?:(?:开始|继续|直接)(?:做|执行|推进|制作|开发|实现|完成|把项目做完)(?:吧|即可|下去)?[。！!]?)$/u.test(
      command,
    ) ||
    /^(?:(?:开始|继续)(?:按当前路线|执行|制作|开发|推进|实现|把项目做完)(?:吧|即可|下去)?[。！!]?)$/u.test(
      command,
    );

  return explicitCommand ? { instruction: text } : null;
}
