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
      `SELECT w.id, w.title, w.category, w.created_at, w.updated_at, u.name AS owner,
        COALESCE(usage.requests, 0) AS aiRequests,
        COALESCE(usage.totalTokens, 0) AS aiTokens,
        COALESCE(usage.plannerTokens, 0) AS plannerTokens,
        COALESCE(usage.dialogueTokens, 0) AS dialogueTokens,
        COALESCE(usage.workbenchTokens, 0) AS workbenchTokens,
        COALESCE(usage.legacyTokens, 0) AS legacyTokens,
        COALESCE(usage.flashInputTokens, 0) AS flashInputTokens,
        COALESCE(usage.flashOutputTokens, 0) AS flashOutputTokens,
        COALESCE(usage.flashCacheMeasuredInputTokens, 0) AS flashCacheMeasuredInputTokens,
        COALESCE(usage.flashCacheMeasuredHitTokens, 0) AS flashCacheMeasuredHitTokens
       FROM workspaces w JOIN users u ON u.id = w.user_id
       LEFT JOIN (
         SELECT workspace_id, user_id, COUNT(*) AS requests, SUM(total_tokens) AS totalTokens,
           SUM(CASE WHEN source = 'planner' THEN total_tokens ELSE 0 END) AS plannerTokens,
           SUM(CASE WHEN source = 'dialogue' THEN total_tokens ELSE 0 END) AS dialogueTokens,
           SUM(CASE WHEN source = 'workbench' THEN total_tokens ELSE 0 END) AS workbenchTokens,
           SUM(CASE WHEN source = 'unknown' THEN total_tokens ELSE 0 END) AS legacyTokens,
           SUM(CASE WHEN model IN ('deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp') THEN input_tokens ELSE 0 END) AS flashInputTokens,
           SUM(CASE WHEN model IN ('deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp') THEN output_tokens ELSE 0 END) AS flashOutputTokens,
           SUM(CASE WHEN model IN ('deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp') THEN cache_measured_input_tokens ELSE 0 END) AS flashCacheMeasuredInputTokens,
           SUM(CASE WHEN model IN ('deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp') THEN cache_measured_hit_tokens ELSE 0 END) AS flashCacheMeasuredHitTokens
         FROM ai_usage WHERE workspace_id IS NOT NULL GROUP BY workspace_id, user_id
       ) usage ON usage.workspace_id = w.id AND usage.user_id = w.user_id
       ORDER BY w.updated_at DESC LIMIT 100`,
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
        COALESCE(SUM(cache_measured_input_tokens), 0) AS cacheMeasuredInputTokens,
        COALESCE(SUM(cache_measured_hit_tokens), 0) AS cacheMeasuredHitTokens,
        COALESCE(SUM(output_tokens), 0) AS outputTokens,
        COALESCE(SUM(total_tokens), 0) AS totalTokens,
        COALESCE(SUM(CASE WHEN model IN ('deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp') THEN input_tokens ELSE 0 END), 0) AS flashInputTokens,
        COALESCE(SUM(CASE WHEN model IN ('deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp') THEN output_tokens ELSE 0 END), 0) AS flashOutputTokens,
        COALESCE(SUM(CASE WHEN model IN ('deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp') THEN cache_measured_input_tokens ELSE 0 END), 0) AS flashCacheMeasuredInputTokens,
        COALESCE(SUM(CASE WHEN model IN ('deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp') THEN cache_measured_hit_tokens ELSE 0 END), 0) AS flashCacheMeasuredHitTokens,
        COALESCE(ROUND(AVG(latency_ms)), 0) AS averageLatencyMs,
        COALESCE(SUM(CASE WHEN operation = 'plan' THEN 1 ELSE 0 END), 0) AS planningRequests,
        COALESCE(SUM(CASE WHEN source = 'dialogue' THEN 1 ELSE 0 END), 0) AS dialogueRequests,
        COALESCE(SUM(CASE WHEN source = 'workbench' THEN 1 ELSE 0 END), 0) AS workbenchRequests,
        COALESCE(SUM(CASE WHEN source = 'healthcheck' THEN 1 ELSE 0 END), 0) AS healthcheckRequests,
        COALESCE(SUM(CASE WHEN source = 'unknown' THEN 1 ELSE 0 END), 0) AS legacyRequests
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
        COALESCE(SUM(cache_measured_input_tokens), 0) AS cacheMeasuredInputTokens,
        COALESCE(SUM(cache_measured_hit_tokens), 0) AS cacheMeasuredHitTokens,
        COALESCE(SUM(latency_ms), 0) AS latencyMs,
        COALESCE(SUM(CASE WHEN operation = 'plan' THEN 1 ELSE 0 END), 0) AS planningRequests,
        COALESCE(SUM(CASE WHEN source = 'dialogue' THEN 1 ELSE 0 END), 0) AS dialogueRequests,
        COALESCE(SUM(CASE WHEN source = 'workbench' THEN 1 ELSE 0 END), 0) AS workbenchRequests,
        COALESCE(SUM(CASE WHEN source = 'healthcheck' THEN 1 ELSE 0 END), 0) AS healthcheckRequests,
        COALESCE(SUM(CASE WHEN source = 'unknown' THEN 1 ELSE 0 END), 0) AS legacyRequests
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
    cacheMeasuredInputTokens: number;
    cacheMeasuredHitTokens: number;
    latencyMs: number;
    planningRequests: number;
    dialogueRequests: number;
    workbenchRequests: number;
    healthcheckRequests: number;
    legacyRequests: number;
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
      cacheMeasuredInputTokens: row?.cacheMeasuredInputTokens ?? 0,
      cacheMeasuredHitTokens: row?.cacheMeasuredHitTokens ?? 0,
      latencyMs: row?.latencyMs ?? 0,
      planningRequests: row?.planningRequests ?? 0,
      dialogueRequests: row?.dialogueRequests ?? 0,
      workbenchRequests: row?.workbenchRequests ?? 0,
      healthcheckRequests: row?.healthcheckRequests ?? 0,
      legacyRequests: row?.legacyRequests ?? 0,
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
