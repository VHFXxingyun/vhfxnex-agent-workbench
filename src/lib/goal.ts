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
export type Artifact = {
  id: string;
  type: "document" | "budget" | "timeline";
  title: string;
  description: string;
  content: string;
};
export type ToolEvent = {
  id: string;
  name: string;
  title: string;
  detail: string;
  status: "done" | "running";
};

export type GoalPlan = {
  title: string;
  category: string;
  summary: string;
  constraints: string[];
  routes: RouteOption[];
  tasks: Task[];
  question: string;
};

export type ExecutionResult = {
  summary: string;
  tasks: Task[];
  milestones: Milestone[];
  artifacts: Artifact[];
  events: ToolEvent[];
};

export type Workspace = {
  id: string;
  prompt: string;
  plan: GoalPlan;
  selectedRouteId: string;
  result: ExecutionResult | null;
  createdAt: string;
  mode: "live" | "demo";
};

const uid = () => Math.random().toString(36).slice(2, 10);

function classify(input: string) {
  if (/开发|代码|网站|软件|项目|产品|小程序|app|APP|需求|上线/.test(input)) return "project";
  if (/日程|一周|每天|学习|复习|安排|时间|习惯/.test(input)) return "schedule";
  if (/旅行|旅游|出行|行程/.test(input)) return "travel";
  return "event";
}

export function demoPlan(prompt: string): GoalPlan {
  const kind = classify(prompt);
  const config = {
    event: {
      title: "让这场活动，从想法走向现场",
      category: "活动策划",
      summary: "先锁定目标与约束，再并行推进筹备、宣传与现场执行。",
      routes: [
        ["完整活动落地", "从筹备到复盘的全流程", 96, "目标包含明确的执行诉求，适合建立完整项目空间。"],
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
      question: "你希望优先确定活动日期与场地，还是先拿到一版完整策划案？",
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
      question: "你希望计划偏向效率冲刺，还是给休息和突发事项留更多空间？",
    },
    project: {
      title: "把模糊需求，变成可交付的项目",
      category: "项目推进",
      summary: "从目标和限制出发，拆解里程碑、依赖关系与可交付成果。",
      routes: [
        ["完整交付路线", "需求、实现、检查、上线", 97, "目标指向一个可交付项目，适合明确阶段和责任。"],
        ["原型验证路线", "先验证核心体验", 81, "适合需求还在变化，需要尽早收集反馈。"],
        ["技术方案优先", "先解决架构与可行性", 72, "适合技术约束较多的项目。"],
      ],
      tasks: [
        ["定义用户与核心问题", "写清用户任务和成功标准", "发现"],
        ["确定范围与技术方案", "拆出必须实现的功能与技术边界", "规划"],
        ["搭建可用原型", "实现从入口到结果的主流程", "开发"],
        ["联调并修复问题", "检查数据、交互与异常路径", "交付"],
        ["准备上线与演示", "整理说明、部署和展示材料", "交付"],
      ],
      question: "这个项目当前更需要先验证用户体验，还是优先完成可运行版本？",
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
      question: "你希望这次旅行更注重体验丰富度，还是轻松和预算控制？",
    },
  }[kind];

  return {
    title: config.title,
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
  };
}

export function demoExecute(plan: GoalPlan, route: RouteOption): ExecutionResult {
  const now = new Date();
  const date = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  };
  const isEvent = plan.category === "活动策划";
  const milestones = [
    { label: "目标与范围确认", date: date(0), note: "锁定方向与约束" },
    { label: "核心准备完成", date: date(3), note: "完成资源与任务分配" },
    { label: "第一轮成果", date: date(6), note: "检查产物并调整" },
    { label: "交付与复盘", date: date(10), note: "形成最终成果" },
  ];
  const budgetItems = isEvent
    ? [{ name: "场地与设备", amount: 800 }, { name: "宣传物料", amount: 450 }, { name: "现场物资", amount: 900 }, { name: "应急预留", amount: 350 }]
    : [{ name: "核心资源", amount: 600 }, { name: "设计与材料", amount: 350 }, { name: "应急预留", amount: 250 }];
  const total = budgetItems.reduce((sum, item) => sum + item.amount, 0);
  return {
    summary: `已按「${route.title}」建立工作空间，生成任务、时间节点和初版方案。你可以继续调整计划，我会据此更新后续步骤。`,
    tasks: plan.tasks,
    milestones,
    artifacts: [
      { id: uid(), type: "document", title: `${plan.category} · 初版方案`, description: "根据目标与所选路线生成", content: `${plan.title}\n\n执行路线：${route.title}\n\n${plan.summary}\n\n阶段任务：\n${plan.tasks.map((task, index) => `${index + 1}. ${task.title} — ${task.detail}`).join("\n")}` },
      { id: uid(), type: "timeline", title: "执行时间线", description: `${milestones.length} 个关键节点`, content: milestones.map((m) => `${m.date} · ${m.label} — ${m.note}`).join("\n") },
      { id: uid(), type: "budget", title: "资源预算草案", description: `预计 ¥${total.toLocaleString("zh-CN")}`, content: `${budgetItems.map((item) => `${item.name}：¥${item.amount}`).join("\n")}\n合计：¥${total}` },
    ],
    events: [
      { id: uid(), name: "create_tasks", title: "任务已建立", detail: `创建 ${plan.tasks.length} 项可跟进任务`, status: "done" },
      { id: uid(), name: "build_timeline", title: "时间线已生成", detail: `整理 ${milestones.length} 个关键节点`, status: "done" },
      { id: uid(), name: "draft_document", title: "方案已起草", detail: "可以在产物区查看和复制", status: "done" },
      { id: uid(), name: "calculate_budget", title: "预算已核算", detail: `当前草案总额 ¥${total}`, status: "done" },
    ],
  };
}
