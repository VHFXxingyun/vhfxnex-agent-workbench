import { NextRequest, NextResponse } from "next/server";
import { demoPlan, type GoalPlan } from "@/lib/goal";

export const runtime = "nodejs";

function normalizePlan(value: unknown, fallback: GoalPlan): GoalPlan {
  if (!value || typeof value !== "object") return fallback;
  const data = value as Record<string, unknown>;
  const routes = Array.isArray(data.routes) ? data.routes.slice(0, 3) : [];
  const tasks = Array.isArray(data.tasks) ? data.tasks.slice(0, 8) : [];
  if (routes.length < 2 || tasks.length < 2) return fallback;
  return {
    title: typeof data.title === "string" ? data.title : fallback.title,
    category: typeof data.category === "string" ? data.category : fallback.category,
    summary: typeof data.summary === "string" ? data.summary : fallback.summary,
    constraints: Array.isArray(data.constraints) ? data.constraints.filter((x): x is string => typeof x === "string").slice(0, 5) : fallback.constraints,
    question: typeof data.question === "string" ? data.question : fallback.question,
    routes: routes.map((item, index) => {
      const route = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        id: `route-${index + 1}`,
        title: String(route.title || fallback.routes[index]?.title || "执行路线"),
        subtitle: String(route.subtitle || "可选的推进方式"),
        fit: Math.max(40, Math.min(99, Number(route.fit) || 85 - index * 10)),
        reason: String(route.reason || "根据当前目标与约束生成"),
        accent: (["violet", "cyan", "amber"] as const)[index],
      };
    }),
    tasks: tasks.map((item, index) => {
      const task = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        id: `task-${index + 1}`,
        title: String(task.title || `任务 ${index + 1}`),
        detail: String(task.detail || "等待完善"),
        phase: String(task.phase || "准备"),
        status: "pending" as const,
      };
    }),
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 4000) : "";
    if (prompt.length < 6) return NextResponse.json({ error: "请再详细描述一下你的目标。" }, { status: 400 });
    const fallback = demoPlan(prompt);
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return NextResponse.json({ plan: fallback, mode: "demo" });

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "deepseek-flash",
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        max_tokens: 1500,
        messages: [
          { role: "system", content: "你是目标驱动工作平台的规划助手。请只输出JSON对象，不能输出Markdown。根据用户目标推断任务类型与约束，设计3条合理而有区别的执行路线，第一条为首选。每条路线含title、subtitle、fit(0-100)、reason。再给出4-7项可执行任务，字段title、detail、phase。顶层字段必须为title、category、summary、constraints(字符串数组)、routes、tasks、question。不要捏造用户没有给出的具体日期、预算或外部事实；不确定时写入question。中文简洁。" },
          { role: "user", content: prompt },
        ],
      }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`DeepSeek 请求失败（${response.status}）`);
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("模型没有返回可解析的计划");
    const plan = normalizePlan(JSON.parse(content), fallback);
    return NextResponse.json({ plan, mode: "live" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "生成计划失败" }, { status: 500 });
  }
}
