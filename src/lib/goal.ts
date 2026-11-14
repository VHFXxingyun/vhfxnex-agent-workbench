export type RouteOption = {
  id: string;
  title: string;
  subtitle: string;
  fit: number;
  reason: string;
  accent: "violet" | "cyan" | "amber";
};

export type Task = {
  id: string;
  title: string;
  detail: string;
  phase: string;
  status: "pending" | "done";
};

export type Milestone = { label: string; date: string; note: string };

export function sortMilestonesChronologically(milestones: Milestone[]): Milestone[] {
  return milestones
    .map((milestone, index) => ({
      milestone,
      index,
      date: (() => {
        const value = milestone.date.trim();
        const absolute = value.match(/^(\d{4}-\d{2}-\d{2})/);
        if (absolute) return `0:${absolute[1]}`;
        const relative = value.match(/^(?:第\s*(\d+)\s*天|Day\s*(\d+))/i);
        if (relative) return `1:${String(relative[1] || relative[2]).padStart(4, "0")}`;
        if (/^活动当天/.test(value)) return "1:0000";
        return undefined;
      })(),
      time: (() => {
        const match = milestone.date.match(/(?:^|[·T\s])([0-2]?\d):([0-5]\d)/);
        if (!match) return undefined;
        const hours = Number(match[1]);
        if (hours > 23) return undefined;
        return hours * 60 + Number(match[2]);
      })(),
    }))
    .sort((a, b) => {
      if (a.date && b.date) {
        const dateOrder = a.date.localeCompare(b.date);
        if (dateOrder) return dateOrder;
        if (a.time !== undefined && b.time !== undefined && a.time !== b.time)
          return a.time - b.time;
        return a.index - b.index;
      }
      if (a.date) return -1;
      if (b.date) return 1;
      return a.index - b.index;
    })
    .map(({ milestone }) => milestone);
}

export type ProjectFile = {
  path: string;
  content: string;
};
export type ChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  kind: "text" | "image";
  content: string;
};
export type Artifact = {
  id: string;
  type: "document" | "pdf" | "budget" | "timeline" | "code" | "spreadsheet" | "presentation";
  title: string;
  description: string;
  content: string;
  files?: ProjectFile[];
};
export type SearchSource = { title: string; url: string; snippet: string };
export type ToolEvent = {
  id: string;
  name: string;
  title: string;
  detail: string;
  status: "done" | "running";
  sources?: SearchSource[];
};
export type AiRunUsage = {
  model: string;
  inputTokens: number;
  cachedInputTokens?: number;
  /** Input tokens from requests where the provider returned cache statistics. */
  cacheMeasuredInputTokens?: number;
  /** Cache-hit tokens from the same measured requests. */
  cacheMeasuredHitTokens?: number;
  /** Provider-reported reasoning tokens, included in outputTokens. */
  reasoningTokens?: number;
  /** Requests where the provider reported the reasoning-token breakdown. */
  reasoningMeasuredRequests?: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  requests: number;
};
export function combineAiUsage(
  current?: AiRunUsage,
  incoming?: AiRunUsage,
): AiRunUsage | undefined {
  if (!incoming) return current;
  if (!current) return incoming;
  return {
    model: incoming.model || current.model,
    inputTokens: current.inputTokens + incoming.inputTokens,
    ...(current.cachedInputTokens !== undefined || incoming.cachedInputTokens !== undefined
      ? { cachedInputTokens: (current.cachedInputTokens || 0) + (incoming.cachedInputTokens || 0) }
      : {}),
    ...(current.cacheMeasuredInputTokens !== undefined ||
    incoming.cacheMeasuredInputTokens !== undefined
      ? {
          cacheMeasuredInputTokens:
            (current.cacheMeasuredInputTokens || 0) + (incoming.cacheMeasuredInputTokens || 0),
          cacheMeasuredHitTokens:
            (current.cacheMeasuredHitTokens || 0) + (incoming.cacheMeasuredHitTokens || 0),
        }
      : {}),
    ...(current.reasoningTokens !== undefined || incoming.reasoningTokens !== undefined
      ? {
          reasoningTokens: (current.reasoningTokens || 0) + (incoming.reasoningTokens || 0),
          reasoningMeasuredRequests:
            (current.reasoningMeasuredRequests || 0) + (incoming.reasoningMeasuredRequests || 0),
        }
      : {}),
    outputTokens: current.outputTokens + incoming.outputTokens,
    totalTokens: current.totalTokens + incoming.totalTokens,
    latencyMs: current.latencyMs + incoming.latencyMs,
    requests: current.requests + incoming.requests,
  };
}
export type KnowledgeSource = {
  id: string;
  title: string;
  excerpt: string;
  score: number;
  matchType?: "semantic" | "keyword" | "hybrid";
};
export type AgentRole = "planner" | "dialogue" | "workbench";
export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Identifies which specialized agent authored this assistant message. */
  agent?: AgentRole;
  toolEvents?: ToolEvent[];
  progress?: string[];
};

export type GoalPlan = {
  title: string;
  category: string;
  summary: string;
  constraints: string[];
  routes: RouteOption[];
  tasks: Task[];
  question: string;
  sources: KnowledgeSource[];
};

export type ExecutionResult = {
  summary: string;
  tasks: Task[];
  milestones: Milestone[];
  artifacts: Artifact[];
  events: ToolEvent[];
  usage?: AiRunUsage;
  budget?: {
    limit: number | null;
    total: number;
    remaining: number | null;
    status: "within" | "over" | "unknown";
  };
};

export function extractBudgetLimit(prompt: string): number | null {
  const match =
    prompt.match(/(?:预算|经费|成本)[^，,。；;]{0,24}?[￥¥]?\s*(\d+(?:\.\d+)?)\s*(万|千)?\s*元/) ||
    prompt.match(
      /(?:预算|经费|成本)(?:上限|控制在|不超过|为|约|是)?\s*[：:]?\s*[￥¥]?\s*(\d+(?:\.\d+)?)\s*(万|千)?\s*元?/,
    );
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return (
    Math.round(value * (match[2] === "万" ? 10_000 : match[2] === "千" ? 1_000 : 1) * 100) / 100
  );
}

export type Workspace = {
  id: string;
  prompt: string;
  plan: GoalPlan;
  selectedRouteId: string;
  result: ExecutionResult | null;
  conversation?: ConversationMessage[];
  usage?: AiRunUsage;
  createdAt: string;
  mode: "live" | "demo";
};

const uid = () => crypto.randomUUID();

function classify(input: string) {
  if (/开发|代码|网站|软件|项目|产品|小程序|app|APP|需求|上线/.test(input)) return "project";
  if (/旅行|旅游|出行|行程/.test(input)) return "travel";
  if (
    /活动|社团|招新|会议|聚会|展览|读书会|讲座|工作坊|比赛|竞赛|沙龙|招募|发布会|班会|训练营/.test(
      input,
    )
  )
    return "event";
  if (/日程|一周|每天|学习|复习|安排|时间|习惯/.test(input)) return "schedule";
  return "event";
}

export function demoPlan(prompt: string): GoalPlan {
  const kind = classify(prompt);
  const titleCandidates = [
    ...prompt.matchAll(
      /(?:策划|规划|筹备|组织|举办|安排|开发|制作|推进|完成|执行)(?:好|一下|一次|一场|一个|一份)?\s*([^，,。；;！？!?]{2,36})/g,
    ),
  ];
  const contextualTitle = titleCandidates
    .at(-1)?.[1]
    .replace(/^(?:(?:帮我|请为|我们|团队|一周内|两周内|下周|本周|一次|一场|一个|一份)\s*)+/g, "")
    .replace(/^[\s，,、；;：:。！？!?]+|[\s，,、；;：:。！？!?]+$/g, "")
    .trim()
    .slice(0, 28);
  const config = {
    event: {
      title: "让这场活动，从想法走向现场",
      category: "活动策划",
      summary: "先锁定目标与约束，再并行推进筹备、宣传与现场执行。",
      routes: [
        [
          "完整活动落地",
          "从筹备到复盘的全流程",
          96,
          "目标包含明确的执行诉求，适合建立完整项目空间。",
        ],
        ["策划案优先", "先形成一份可讨论的方案", 78, "适合团队尚未确定活动形式时先对齐方向。"],
        ["时间与预算先行", "先排可行性，再扩展内容", 68, "当期限或预算非常紧时更稳妥。"],
      ],
      tasks: [
        ["明确活动目标与参与对象", "整理活动定位、预计规模和成功标准", "策略"],
        ["确认场地与日期", "列出场地需求、可用时段及备选方案", "筹备"],
        ["制定预算与资源清单", "分配场地、物料、宣传及应急预算", "筹备"],
        ["制作宣传和报名材料", "产出海报文案、报名说明和发布节奏", "执行"],
        ["制定现场分工与流程", "形成按时间顺序执行的现场清单", "执行"],
      ],
      question: "",
    },
    schedule: {
      title: "把时间，安排成真正能完成的计划",
      category: "日程规划",
      summary: "识别固定安排、优先事项和空闲时段，生成可调整的行动节奏。",
      routes: [
        ["均衡日程", "兼顾重点任务与休息", 94, "适合持续一周以上的安排，能减少时间冲突。"],
        ["冲刺模式", "集中时间处理最高优先级", 79, "适合有明确截止时间的阶段性目标。"],
        ["轻量待办", "先列清单，逐步完善日程", 64, "适合目前信息还不完整的情况。"],
      ],
      tasks: [
        ["收集固定事项", "记录课程、会议和已经约定的安排", "整理"],
        ["确定本周三件重点", "选择真正需要优先完成的目标", "规划"],
        ["分配专注时段", "为每项重点预留可执行的时间", "排期"],
        ["设置缓冲与复盘", "保留调整空间并安排阶段回顾", "跟进"],
      ],
      question: "",
    },
    project: {
      title: "把模糊需求，变成可交付的项目",
      category: "项目推进",
      summary: "从目标和限制出发，拆解里程碑、依赖关系与可交付成果。",
      routes: [
        [
          "完整交付路线",
          "需求、实现、检查、上线",
          97,
          "目标指向一个可交付项目，适合明确阶段和责任。",
        ],
        ["原型验证路线", "先验证核心体验", 81, "适合需求还在变化，需要尽早收集反馈。"],
        ["技术方案优先", "先解决架构与可行性", 72, "适合技术约束较多的项目。"],
      ],
      tasks: [
        ["定义用户与核心问题", "写清用户任务和成功标准", "发现"],
        ["确定范围与技术方案", "拆出必须实现的功能与技术边界", "规划"],
        ["确认开发环境与依赖", "列出运行环境、开发工具、依赖和启动方式", "环境准备"],
        ["搭建可用原型", "实现从入口到结果的主流程", "开发"],
        ["联调并修复问题", "检查数据、交互与异常路径", "交付"],
        ["准备上线与演示", "整理说明、部署和展示材料", "交付"],
      ],
      question: "",
    },
    travel: {
      title: "让一次出行，拥有清晰的节奏",
      category: "旅行规划",
      summary: "根据时间、预算和偏好组织行程，并保留可调整空间。",
      routes: [
        ["完整行程规划", "交通、住宿、体验与预算", 93, "适合明确目的地与时间的出行目标。"],
        ["目的地探索", "先比较方向，再安排细节", 76, "适合尚未确定出行地点。"],
        ["预算优先", "先控制成本与时间", 68, "适合预算有限或时间紧张的行程。"],
      ],
      tasks: [
        ["确认时间与预算", "记录出发日期、人数和费用范围", "准备"],
        ["筛选目的地与体验", "根据偏好建立候选清单", "探索"],
        ["规划每日路线", "安排交通、活动和休息时间", "排期"],
        ["检查预订与出行清单", "整理证件、预订事项和提醒", "出发"],
      ],
      question: "",
    },
  }[kind];

  return {
    title: contextualTitle || config.title,
    category: config.category,
    summary: config.summary,
    constraints: ["根据你提供的目标自动提取", "可以在执行前继续补充或修改"],
    routes: config.routes.map((r, index) => ({
      id: `route-${index + 1}`,
      title: String(r[0]),
      subtitle: String(r[1]),
      fit: Number(r[2]),
      reason: String(r[3]),
      accent: (["violet", "cyan", "amber"] as const)[index],
    })),
    tasks: config.tasks.map((t, index) => ({
      id: `task-${index + 1}`,
      title: String(t[0]),
      detail: String(t[1]),
      phase: String(t[2]),
      status: "pending",
    })),
    question: config.question,
    sources: [],
  };
}

export function demoExecute(plan: GoalPlan, route: RouteOption, prompt = ""): ExecutionResult {
  const now = new Date();
  const chinaToday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  })
    .formatToParts(now)
    .reduce<Record<string, number>>((parts, part) => {
      if (part.type !== "literal") parts[part.type] = Number(part.value);
      return parts;
    }, {});
  const chinaCalendarDate = new Date(
    Date.UTC(chinaToday.year, chinaToday.month - 1, chinaToday.day, 12),
  );
  const chinaDateFormatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
  });
  const date = (days: number) => {
    const d = new Date(chinaCalendarDate);
    d.setUTCDate(d.getUTCDate() + days);
    return chinaDateFormatter.format(d);
  };
  const isEvent = plan.category === "活动策划";
  const wantsSchedule =
    /日程|作息|每天|每日|时间表|时间安排|安排.{0,6}时间|时间.{0,6}安排|安排.{0,6}(?:一天|一周)|行程|旅行|旅游|出行|活动流程|流程表|议程|agenda|itinerary|schedule/i.test(
      prompt,
    );
  const hasBudget = /预算|经费|成本|费用|金额|元|\d+\s*块/.test(prompt);
  const durationDays = /两周|2\s*周|14\s*天/.test(prompt)
    ? 14
    : /一周|1\s*周|七天|7\s*天/.test(prompt)
      ? 7
      : 10;
  const projectMilestones = [
    { label: "目标与范围确认", date: date(0), note: "锁定方向与约束" },
    {
      label: "核心准备完成",
      date: date(Math.max(1, Math.round(durationDays * 0.3))),
      note: "完成资源与任务分配",
    },
    {
      label: "第一轮成果",
      date: date(Math.max(2, Math.round(durationDays * 0.6))),
      note: "检查产物并调整",
    },
    { label: "交付与复盘", date: date(durationDays), note: "形成最终成果" },
  ];
  const scheduleMilestones: Milestone[] =
    plan.category === "旅行规划"
      ? [
          {
            label: "出发与抵达",
            date: "第 1 天 · 09:00–11:00",
            note: "交通方式按实际预订信息确认",
          },
          { label: "城市探索", date: "第 1 天 · 14:00–17:00", note: "预留途中休息时间" },
          { label: "上午游览", date: "第 2 天 · 09:00–12:00", note: "景点顺序可按天气调整" },
          { label: "返程整理", date: "第 3 天 · 14:00–17:00", note: "预留交通缓冲时间" },
        ]
      : plan.category === "日程规划"
        ? [
            { label: "专注学习", date: "第 1 天 · 08:30–10:00", note: "优先处理高难度任务" },
            { label: "课程与作业", date: "第 1 天 · 10:30–12:00", note: "安排短暂休息" },
            { label: "复习与整理", date: "第 1 天 · 14:00–16:00", note: "按实际课表调整" },
            { label: "运动与复盘", date: "第 1 天 · 17:00–18:00", note: "保留弹性时间" },
          ]
        : [
            { label: "签到与暖场", date: "活动当天 · 09:00–09:20", note: "预留设备检查与入场时间" },
            { label: "主题分享", date: "活动当天 · 09:20–10:30", note: "按现场节奏安排互动" },
            { label: "交流与体验", date: "活动当天 · 10:30–11:40", note: "设置问答和体验环节" },
            { label: "收尾与撤场", date: "活动当天 · 11:40–12:00", note: "整理物资并确认场地" },
          ];
  const milestones = wantsSchedule ? scheduleMilestones : projectMilestones;
  const limit = extractBudgetLimit(prompt);
  const total = limit === null ? (isEvent ? 2500 : 1200) : Math.floor(limit * 0.875);
  const budgetNames = isEvent
    ? ["场地与设备", "宣传物料", "现场物资", "应急预留"]
    : ["核心资源", "设计与材料", "应急预留"];
  const weights = isEvent ? [0.24, 0.18, 0.4, 0.18] : [0.5, 0.29, 0.21];
  let allocated = 0;
  const budgetItems = budgetNames.map((name, index) => {
    const amount =
      index === budgetNames.length - 1 ? total - allocated : Math.floor(total * weights[index]);
    allocated += amount;
    return { name, amount };
  });
  return {
    summary: `已按「${route.title}」建立工作空间，生成任务、时间节点和初版方案。你可以继续调整计划，我会据此更新后续步骤。`,
    tasks: plan.tasks,
    milestones,
    artifacts: [
      {
        id: uid(),
        type: "document",
        title: `${plan.category} · 初版方案`,
        description: "根据目标与所选路线生成",
        content: `${plan.title}\n\n执行路线：${route.title}\n\n${plan.summary}\n\n阶段任务：\n${plan.tasks.map((task, index) => `${index + 1}. ${task.title} — ${task.detail}`).join("\n")}`,
      },
      {
        id: uid(),
        type: "timeline",
        title: wantsSchedule ? "执行时间线与日程" : "执行时间线",
        description: wantsSchedule
          ? `${milestones.length} 个演示时段`
          : `${milestones.length} 个关键节点`,
        content: milestones.map((m) => `${m.date} · ${m.label} — ${m.note}`).join("\n"),
      },
      ...(hasBudget
        ? [
            {
              id: uid(),
              type: "budget" as const,
              title: "资源预算草案",
              description: `预计 ¥${total.toLocaleString("zh-CN")}`,
              content: `${budgetItems.map((item) => `${item.name}：¥${item.amount}`).join("\n")}\n合计：¥${total}`,
            },
          ]
        : []),
    ],
    events: [
      {
        id: uid(),
        name: "create_tasks",
        title: "任务已建立",
        detail: `创建 ${plan.tasks.length} 项可跟进任务`,
        status: "done",
      },
      {
        id: uid(),
        name: "build_timeline",
        title: "时间线已生成",
        detail: `整理 ${milestones.length} 个关键节点`,
        status: "done",
      },
      ...(wantsSchedule
        ? [
            {
              id: uid(),
              name: "build_schedule",
              title: "日程时段已安排",
              detail: `整理 ${milestones.length} 个演示时段`,
              status: "done" as const,
            },
          ]
        : []),
      {
        id: uid(),
        name: "draft_document",
        title: "方案已起草",
        detail: "可以在产物区查看和复制",
        status: "done",
      },
      ...(hasBudget
        ? [
            {
              id: uid(),
              name: "calculate_budget",
              title: "预算已核算",
              detail: `当前草案总额 ¥${total}`,
              status: "done" as const,
            },
          ]
        : []),
    ],
    budget: hasBudget
      ? {
          limit,
          total,
          remaining: limit === null ? null : limit - total,
          status: limit === null ? "unknown" : total > limit ? "over" : "within",
        }
      : undefined,
  };
}

export function demoFollowUp(
  current: ExecutionResult,
  instruction: string,
): ExecutionResult | null {
  const match = instruction.match(
    /(?:新增|添加|增加)\s*(?:一项|一个|一条)?\s*(?:新(?:的)?\s*)?任务\s*[:：]?\s*(.+)/u,
  );
  if (!match) return null;
  const title = match[1]
    .split(/[\r\n。！？!?]/u, 1)[0]
    .trim()
    .replace(/[，,；;]+$/u, "")
    .slice(0, 120);
  if (!title) return null;

  const duplicate = current.tasks.some((task) => task.title.trim() === title);
  const atLimit = current.tasks.length >= 60;
  const tasks =
    duplicate || atLimit
      ? current.tasks
      : [
          ...current.tasks,
          {
            id: uid(),
            title,
            detail: "由本地演示规则根据补充指示生成；该操作没有调用模型。",
            phase: "补充指示",
            status: "pending" as const,
          },
        ];
  const detail = duplicate
    ? `已有同名任务「${title}」，没有重复添加。`
    : atLimit
      ? "已达到演示任务上限，没有添加新任务。"
      : `新增任务「${title}」。本地演示规则模拟 create_tasks，没有调用模型。`;

  return {
    ...current,
    summary: duplicate
      ? `演示模式检查到「${title}」已经存在，没有重复创建。`
      : atLimit
        ? "演示任务已达到上限；现有工作空间保持不变。"
        : `演示模式已模拟新增任务「${title}」。这条操作由本地规则生成，没有调用模型。`,
    tasks,
    events: [
      ...current.events,
      {
        id: uid(),
        name: "create_tasks",
        title: duplicate || atLimit ? "演示任务未重复添加" : "演示任务已补充",
        detail,
        status: "done" as const,
      },
    ].slice(-100),
  };
}
