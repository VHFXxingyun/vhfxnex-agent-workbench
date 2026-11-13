import nextEnv from "@next/env";
import Database from "better-sqlite3";
import { SignJWT } from "jose";
import crypto from "node:crypto";
import { resolveDatabasePath } from "../src/lib/database-path.mjs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), process.argv.includes("--dev"));

const sessionSecret = process.env.SESSION_SECRET || "";
if (new TextEncoder().encode(sessionSecret).byteLength < 32) {
  console.error("工作区后台队列未启动：SESSION_SECRET 尚未配置。");
  process.exit(1);
}

const portArgument = process.argv.find((argument) => argument.startsWith("--base-url="));
const baseUrl = (
  portArgument?.slice("--base-url=".length) ||
  process.env.GOALFLOW_BASE_URL ||
  `http://127.0.0.1:${process.env.PORT || "3000"}`
).replace(/\/$/, "");
const databasePath = resolveDatabasePath();
const database = new Database(databasePath, {
  timeout: 10_000,
});
database.pragma("busy_timeout = 10000");
database.pragma("journal_mode = WAL");
database.exec(`
  CREATE TABLE IF NOT EXISTS service_heartbeats (
    service TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('starting', 'running', 'stopping', 'stopped')),
    busy INTEGER NOT NULL DEFAULT 0 CHECK (busy IN (0, 1)),
    updated_at INTEGER NOT NULL
  )
`);
const encoder = new TextEncoder();
let stopping = false;
let busy = false;
const shutdownController = new AbortController();
const instanceId = crypto.randomUUID();

function writeHeartbeat(state, isBusy = busy) {
  database
    .prepare(
      `INSERT INTO service_heartbeats (service, instance_id, state, busy, updated_at)
       VALUES ('workbench-worker', ?, ?, ?, ?)
       ON CONFLICT(service) DO UPDATE SET
         instance_id = excluded.instance_id,
         state = excluded.state,
         busy = excluded.busy,
         updated_at = excluded.updated_at`,
    )
    .run(instanceId, state, isBusy ? 1 : 0, Date.now());
}

process.on("SIGINT", () => {
  stopping = true;
  shutdownController.abort();
});
process.on("SIGTERM", () => {
  stopping = true;
  shutdownController.abort();
});

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function createSessionCookie(user) {
  const token = await new SignJWT({ role: user.role, ver: user.session_version })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(encoder.encode(sessionSecret));
  return `goalflow_session=${token}`;
}

async function api(cookie, route, options = {}) {
  return fetch(`${baseUrl}${route}`, {
    ...options,
    signal: options.signal || shutdownController.signal,
    headers: {
      Cookie: cookie,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    cache: "no-store",
  });
}

async function release(cookie, handoffId, token) {
  try {
    await api(cookie, "/api/handoffs", {
      method: "PATCH",
      body: JSON.stringify({ action: "release", id: handoffId, token }),
    });
  } catch {
    // The claim expires and is recovered by the next worker pass if the server is unavailable.
  }
}

async function readTerminalEvent(response) {
  if (!response.body) return { type: "error", message: "服务端未返回执行流。" };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal = null;
  try {
    while (!stopping) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let separator = buffer.indexOf("\n\n");
      while (separator >= 0) {
        const block = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const eventName = block.match(/^event:\s*(\S+)/m)?.[1];
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (data) {
          try {
            const parsed = JSON.parse(data);
            const type = eventName || parsed.type;
            if (type === "result") terminal = { type: "result" };
            if (type === "error")
              terminal = {
                type: "error",
                message:
                  typeof parsed.error === "string" ? parsed.error.slice(0, 300) : "执行失败。",
              };
          } catch {
            // Ignore malformed progress events; the terminal event is validated separately.
          }
        }
        separator = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  return terminal || { type: "error", message: "执行连接结束，但没有收到完成结果。" };
}

async function processNext() {
  const now = new Date().toISOString();
  const rows = database
    .prepare(
      `SELECT h.id, h.user_id, h.workspace_id, h.instruction, h.user_message_id,
              h.user_message, h.attachments_json, w.body AS workspace_body
         FROM workbench_handoffs h
         JOIN workspaces w ON w.id = h.workspace_id
        WHERE (h.status = 'pending' AND (h.next_attempt_at IS NULL OR h.next_attempt_at <= ?))
           OR (h.status = 'running' AND h.claim_expires_at <= ?)
        ORDER BY h.created_at ASC LIMIT 12`,
    )
    .all(now, Date.now());

  for (const row of rows) {
    if (stopping) return;
    const user = database
      .prepare("SELECT id, role, session_version FROM users WHERE id = ?")
      .get(row.user_id);
    if (!user) continue;
    const workspace = (() => {
      try {
        return JSON.parse(row.workspace_body);
      } catch {
        return null;
      }
    })();
    if (!workspace || workspace.mode !== "live" || !workspace.plan?.routes?.length) continue;
    const route =
      workspace.plan.routes.find((option) => option.id === workspace.selectedRouteId) ||
      workspace.plan.routes[0];
    const cookie = await createSessionCookie(user);
    let claimToken = "";
    try {
      const claimResponse = await api(cookie, "/api/handoffs", {
        method: "PATCH",
        body: JSON.stringify({ action: "claim", id: row.id }),
      });
      const claim = await claimResponse.json();
      if (claim.status !== "claimed" || typeof claim.token !== "string") continue;
      claimToken = claim.token;

      const executeResponse = await api(cookie, "/api/execute", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: row.workspace_id,
          goal: workspace.prompt,
          instruction: row.instruction,
          displayMessage: row.user_message,
          dialogMessageId: row.user_message_id,
          handoffJobId: row.id,
          handoffClaimToken: claimToken,
          attachments: JSON.parse(row.attachments_json || "[]"),
          continuation: Boolean(workspace.result),
          plan: workspace.plan,
          route,
          currentTasks: workspace.result?.tasks || [],
          currentMilestones: workspace.result?.milestones || [],
          currentBudget: workspace.result?.budget,
          demo: false,
          thinkingMode: "deep",
        }),
      });
      if (!executeResponse.ok) {
        throw new Error(`执行服务返回 HTTP ${executeResponse.status}。`);
      }
      const terminal = await readTerminalEvent(executeResponse);
      if (terminal.type === "result") {
        await api(cookie, "/api/handoffs", {
          method: "PATCH",
          body: JSON.stringify({ action: "complete", id: row.id, token: claimToken }),
        });
        console.info(`后台任务完成：${row.id}`);
      } else {
        await release(cookie, row.id, claimToken);
        console.error(`后台任务稍后重试：${row.id} · ${terminal.message || "执行失败"}`);
      }
    } catch (error) {
      if (claimToken) await release(cookie, row.id, claimToken);
      const message =
        error instanceof Error && /HTTP \d{3}/.test(error.message)
          ? error.message
          : "连接中断或执行失败";
      console.error(`后台任务暂未完成：${row.id} · ${message}`);
    }
  }
}

writeHeartbeat("running");
const heartbeatTimer = setInterval(() => {
  try {
    writeHeartbeat(stopping ? "stopping" : "running");
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : "心跳写入失败";
    console.error(`后台任务服务心跳写入失败：${message}`);
  }
}, 5_000);
heartbeatTimer.unref();
console.info(`工作区后台任务服务已启动：${baseUrl}`);
if (process.argv.includes("--startup-check-only")) {
  clearInterval(heartbeatTimer);
  writeHeartbeat("stopped", false);
  database.close();
  process.exit(0);
}

const shutdownAfter = Number(
  process.argv.find((argument) => argument.startsWith("--shutdown-after-ms="))?.split("=")[1],
);
if (Number.isFinite(shutdownAfter) && shutdownAfter > 0) {
  setTimeout(() => {
    stopping = true;
    shutdownController.abort();
  }, shutdownAfter).unref();
}

while (!stopping) {
  if (!busy) {
    busy = true;
    try {
      await processNext();
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 200) : "数据库暂不可用";
      if (!message.includes("no such table")) console.error(`后台队列暂不可用：${message}`);
    } finally {
      busy = false;
    }
  }
  await sleep(2_000);
}
clearInterval(heartbeatTimer);
writeHeartbeat("stopped", false);
database.close();
