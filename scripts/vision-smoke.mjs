import assert from "node:assert/strict";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { resolveDatabasePath } from "../src/lib/database-path.mjs";
import { loadSmokeEnvironment } from "./smoke-environment.mjs";

loadSmokeEnvironment();
const baseUrl = new URL(process.env.NEXORA_BASE_URL || "http://localhost:3000");
if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(baseUrl.hostname)) {
  throw new Error("The vision smoke check only runs against a local NEXORA server.");
}

const clientAddress = `198.51.100.${crypto.randomInt(1, 255)}`;
const email = `nexora-vision-${crypto.randomUUID()}@example.test`;
const password = crypto.randomBytes(24).toString("base64url");
const workspaceId = crypto.randomUUID();
const redSwatch =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==";
let userId;
let sessionCookie;
let database;

async function request(route, { method = "GET", body, cookie, timeoutMs = 90_000 } = {}) {
  const headers = { Accept: "application/json", "X-Forwarded-For": clientAddress };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(new URL(route, baseUrl), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { response, payload: await response.json().catch(() => null) };
}

try {
  const health = await fetch(baseUrl, { signal: AbortSignal.timeout(5_000) });
  assert.equal(health.status, 200, "NEXORA preview must be available");

  const registration = await request("/api/auth/register", {
    method: "POST",
    body: { name: "Vision Smoke", email, password },
  });
  assert.equal(registration.response.status, 200, registration.payload?.error || "register failed");
  userId = registration.payload?.user?.id;
  assert.ok(userId, "registration must return an account ID");
  const setCookie =
    registration.response.headers.getSetCookie?.()[0] ||
    registration.response.headers.get("set-cookie");
  sessionCookie = setCookie?.split(";")[0];
  assert.ok(sessionCookie, "registration must establish an authenticated session");

  const planning = await request("/api/plan", {
    method: "POST",
    cookie: sessionCookie,
    body: {
      prompt:
        "请识别附图中占满画面的颜色，为社团海报提出配色计划，并在摘要或任务中明确写出颜色。不要臆测图中其他内容。",
      image: redSwatch,
      demo: false,
      workspaceId,
    },
  });
  assert.equal(planning.response.status, 200, planning.payload?.error || "image planning failed");
  assert.equal(planning.payload?.mode, "live");
  assert.equal(planning.payload?.persisted, true);
  assert.match(
    JSON.stringify(planning.payload?.plan),
    /红|red/i,
    "the live plan must identify the red reference image",
  );
  assert.ok(planning.payload?.usage?.totalTokens > 0, "provider usage must be reported");
  assert.equal(planning.payload?.usage?.model, "deepseek-flash");
  if (planning.payload?.usage?.cachedInputTokens !== undefined) {
    assert.ok(
      planning.payload.usage.cachedInputTokens >= 0 &&
        planning.payload.usage.cachedInputTokens <= planning.payload.usage.inputTokens,
      "reported cached input tokens must not exceed total input tokens",
    );
  }

  console.log(
    `✓ DeepSeek image understanding identified the red reference and saved the plan ` +
      `(${planning.payload.usage.totalTokens} tokens; ` +
      `${planning.payload.usage.cachedInputTokens ?? 0} cached input tokens; one planning request).`,
  );
} finally {
  if (userId) {
    if (sessionCookie) {
      await request(`/api/workspaces/${workspaceId}`, {
        method: "DELETE",
        cookie: sessionCookie,
        timeoutMs: 10_000,
      }).catch(() => {});
    }
    database = new Database(resolveDatabasePath(), {
      timeout: 10_000,
    });
    database.transaction(() => {
      database.prepare("DELETE FROM ai_usage WHERE user_id = ?").run(userId);
      database.prepare("DELETE FROM knowledge_documents WHERE user_id = ?").run(userId);
      database.prepare("DELETE FROM workspaces WHERE user_id = ?").run(userId);
      database.prepare("DELETE FROM users WHERE id = ?").run(userId);
    })();
    database.close();
  }
}
