import { NextRequest, NextResponse } from "next/server";
import { demoExecute, type Artifact, type ExecutionResult, type GoalPlan, type Milestone, type RouteOption, type Task, type ToolEvent } from "@/lib/goal";

export const runtime = "nodejs";

const tools = [
  { type: "function", function: { name: "create_tasks", description: "将计划拆成可跟进的任务。", parameters: { type: "object", properties: { tasks: { type: "array", items: { type: "object", properties: { title: { type: "string" }, detail: { type: "string" }, phase: { type: "string" } }, required: ["title", "detail", "phase"] } } }, required: ["tasks"] } } },
  { type: "function", function: { name: "build_timeline", description: "为目标建立阶段里程碑，不知道具体日期时使用相对日期描述。", parameters: { type: "object", properties: { milestones: { type: "array", items: { type: "object", properties: { label: { type: "string" }, date: { type: "string" }, note: { type: "string" } }, required: ["label", "date", "note"] } } }, required: ["milestones"] } } },
  { type: "function", function: { name: "draft_document", description: "生成一份简短、可编辑的行动方案。", parameters: { type: "object", properties: { title: { type: "string" }, content: { type: "string" } }, required: ["title", "content"] } } },
  { type: "function", function: { name: "calculate_budget", description: "当目标涉及费用或预算时计算项目和总额；没有数据则不要调用。", parameters: { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { name: { type: "string" }, amount: { type: "number" } }, required: ["name", "amount"] } } }, required: ["items"] } } },
];

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 4000) : "";
    const plan = body.plan as GoalPlan;
    const route = body.route as RouteOption;
    if (!prompt || !plan?.tasks || !route?.title) return NextResponse.json({ error: "执行所需的目标或路线不完整" }, { status: 400 });
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return NextResponse.json({ result: demoExecute(plan, route), mode: "demo" });

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-flash",
        thinking: { type: "disabled" },
        max_tokens: 1800,
        tool_choice: "required",
        tools,
        messages: [
          { role: "system", content: "你是目标驱动工作平台的执行Agent。根据用户目标和已选路线调用可用工具，建立任务、时间线和方案。优先调用create_tasks、build_timeline、draft_document；只有用户给出了预算或金额时才调用calculate_budget。不要虚构真实预订、付款或对外发送。工具参数用简洁中文。" },
          { role: "user", content: JSON.stringify({ goal: prompt, route: route.title, plan: plan.tasks, constraints: plan.constraints }) },
        ],
      }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`DeepSeek 请求失败（${response.status}）`);
    const payload = await response.json();
    const calls: ToolCall[] = payload?.choices?.[0]?.message?.tool_calls || [];
    if (calls.length === 0) throw new Error("模型没有调用工具，请重试");
    const tasks: Task[] = [];
    const milestones: Milestone[] = [];
    const artifacts: Artifact[] = [];
    const events: ToolEvent[] = [];
    for (const call of calls.slice(0, 8)) {
      let args: Record<string, unknown>;
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { continue; }
      const name = call.function.name;
      if (name === "create_tasks" && Array.isArray(args.tasks)) {
        for (const item of args.tasks.slice(0, 10)) {
          if (item && typeof item.title === "string") tasks.push({ id: crypto.randomUUID(), title: item.title, detail: String(item.detail || ""), phase: String(item.phase || "准备"), status: "pending" });
        }
        events.push({ id: crypto.randomUUID(), name, title: "任务已建立", detail: `创建 ${tasks.length} 项可跟进任务`, status: "done" });
      } else if (name === "build_timeline" && Array.isArray(args.milestones)) {
        for (const item of args.milestones.slice(0, 8)) {
          if (item && typeof item.label === "string") milestones.push({ label: item.label, date: String(item.date || "待定"), note: String(item.note || "") });
        }
        artifacts.push({ id: crypto.randomUUID(), type: "timeline", title: "执行时间线", description: `${milestones.length} 个关键节点`, content: milestones.map((m) => `${m.date} · ${m.label} — ${m.note}`).join("\n") });
        events.push({ id: crypto.randomUUID(), name, title: "时间线已生成", detail: `整理 ${milestones.length} 个关键节点`, status: "done" });
      } else if (name === "draft_document" && typeof args.title === "string") {
        artifacts.push({ id: crypto.randomUUID(), type: "document", title: args.title, description: "Agent 生成的初版方案", content: String(args.content || "") });
        events.push({ id: crypto.randomUUID(), name, title: "方案已起草", detail: args.title, status: "done" });
      } else if (name === "calculate_budget" && Array.isArray(args.items)) {
        const items = args.items.filter((item) => item && typeof item.name === "string" && typeof item.amount === "number").slice(0, 15);
        const total = items.reduce((sum, item) => sum + item.amount, 0);
        artifacts.push({ id: crypto.randomUUID(), type: "budget", title: "预算草案", description: `合计 ¥${total.toLocaleString("zh-CN")}`, content: `${items.map((item) => `${item.name}：¥${item.amount}`).join("\n")}\n合计：¥${total}` });
        events.push({ id: crypto.randomUUID(), name, title: "预算已核算", detail: `合计 ¥${total.toLocaleString("zh-CN")}`, status: "done" });
      }
    }
    const result: ExecutionResult = {
      summary: `已按「${route.title}」执行 ${events.length} 项工具操作，建立了可继续修改的工作空间。`,
      tasks: tasks.length ? tasks : plan.tasks,
      milestones,
      artifacts,
      events,
    };
    return NextResponse.json({ result, mode: "live" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "执行失败" }, { status: 500 });
  }
}
