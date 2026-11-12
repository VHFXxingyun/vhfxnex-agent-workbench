import { NextResponse } from "next/server";
import database from "@/lib/db";
import { getUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const user = await getUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "无权访问管理后台" }, { status: 403 });
  const users = database
    .prepare(
      "SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC LIMIT 100",
    )
    .all();
  const workspaces = database
    .prepare(
      "SELECT w.id, w.title, w.category, w.created_at, w.updated_at, u.name AS owner FROM workspaces w JOIN users u ON u.id = w.user_id ORDER BY w.updated_at DESC LIMIT 100",
    )
    .all();
  const userCount = (
    database.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }
  ).count;
  const workspaceCount = (
    database.prepare("SELECT COUNT(*) AS count FROM workspaces").get() as { count: number }
  ).count;
  const completedCount = (
    database
      .prepare("SELECT COUNT(*) AS count FROM workspaces WHERE body LIKE '%\"result\":{%' ")
      .get() as { count: number }
  ).count;
  const aiUsage = database
    .prepare(
      `
      SELECT
        COUNT(*) AS requests,
        COALESCE(SUM(input_tokens), 0) AS inputTokens,
        COALESCE(SUM(cached_input_tokens), 0) AS cachedInputTokens,
        COALESCE(SUM(output_tokens), 0) AS outputTokens,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(ROUND(AVG(latency_ms)), 0) AS averageLatencyMs,
        COALESCE(SUM(CASE WHEN operation = 'plan' THEN 1 ELSE 0 END), 0) AS planningRequests,
        COALESCE(SUM(CASE WHEN operation = 'execute' THEN 1 ELSE 0 END), 0) AS executionRequests
      FROM ai_usage
    `,
    )
    .get();
  const todayParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const today = Object.fromEntries(todayParts.map((part) => [part.type, part.value]));
  const firstDay = new Date(
    Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day) - 6),
  );
  const dates = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(firstDay);
    day.setUTCDate(firstDay.getUTCDate() + index);
    return {
      date: day.toISOString().slice(0, 10),
      label: `${day.getUTCMonth() + 1}/${day.getUTCDate()}`,
    };
  });
  const firstDayUtc = new Date(
    Date.UTC(Number(today.year), Number(today.month) - 1, Number(today.day) - 6, -8),
  ).toISOString();
  const dailyRows = database
    .prepare(
      `
      SELECT
        date(created_at, '+8 hours') AS date,
        COUNT(*) AS requests,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(SUM(cached_input_tokens), 0) AS cachedInputTokens,
        COALESCE(SUM(latency_ms), 0) AS latencyMs,
        COALESCE(SUM(CASE WHEN operation = 'plan' THEN 1 ELSE 0 END), 0) AS planningRequests,
        COALESCE(SUM(CASE WHEN operation = 'execute' THEN 1 ELSE 0 END), 0) AS executionRequests
      FROM ai_usage
      WHERE created_at >= ?
      GROUP BY date
    `,
    )
    .all(firstDayUtc) as {
    date: string;
    requests: number;
    totalTokens: number;
    cachedInputTokens: number;
    latencyMs: number;
    planningRequests: number;
    executionRequests: number;
  }[];
  const dailyByDate = new Map(dailyRows.map((row) => [row.date, row]));
  const dailyAiUsage = dates.map(({ date, label }) => {
    const row = dailyByDate.get(date);
    return {
      date,
      label,
      requests: row?.requests ?? 0,
      totalTokens: row?.totalTokens ?? 0,
      cachedInputTokens: row?.cachedInputTokens ?? 0,
      latencyMs: row?.latencyMs ?? 0,
      planningRequests: row?.planningRequests ?? 0,
      executionRequests: row?.executionRequests ?? 0,
    };
  });
  return NextResponse.json({
    userCount,
    workspaceCount,
    completedCount,
    aiUsage,
    dailyAiUsage,
    users,
    workspaces,
  });
}
