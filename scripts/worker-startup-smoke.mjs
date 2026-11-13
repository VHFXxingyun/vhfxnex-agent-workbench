import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "vhfxnex-worker-smoke-"));
const databasePath = path.join(temporaryDirectory, "worker-smoke.sqlite");
const workerEnv = {
  ...process.env,
  SESSION_SECRET: crypto.randomBytes(32).toString("base64url"),
  DEEPSEEK_API_KEY: "",
  GOALFLOW_DATABASE_PATH: databasePath,
};

function readHeartbeat() {
  const database = new Database(databasePath, { readonly: true });
  try {
    return database
      .prepare("SELECT state, busy, updated_at FROM service_heartbeats WHERE service = ?")
      .get("workbench-worker");
  } finally {
    database.close();
  }
}

function waitForClose(child, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Workbench worker did not exit before the smoke check timeout."));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function waitForHeartbeat(expectedState, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const heartbeat = readHeartbeat();
      if (heartbeat?.state === expectedState) return heartbeat;
    } catch {
      // The worker creates the fixture database and heartbeat table during startup.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`Worker heartbeat did not reach state '${expectedState}'.`);
}

try {
  const startupCheck = spawn(
    process.execPath,
    ["scripts/workbench-worker.mjs", "--startup-check-only", "--base-url=http://127.0.0.1:1"],
    { cwd: process.cwd(), env: workerEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  let startupOutput = "";
  let startupError = "";
  startupCheck.stdout.setEncoding("utf8").on("data", (chunk) => (startupOutput += chunk));
  startupCheck.stderr.setEncoding("utf8").on("data", (chunk) => (startupError += chunk));
  const startupExit = await waitForClose(startupCheck);
  assert.equal(
    startupExit.code,
    0,
    `Worker startup check failed: ${startupError || startupOutput}`,
  );
  assert.match(startupOutput, /工作区后台任务服务已启动：http:\/\/127\.0\.0\.1:1/);
  assert.equal(readHeartbeat()?.state, "stopped", "Startup check leaves a stopped heartbeat.");

  const activeWorker = spawn(
    process.execPath,
    ["scripts/workbench-worker.mjs", "--base-url=http://127.0.0.1:1", "--shutdown-after-ms=700"],
    { cwd: process.cwd(), env: workerEnv, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  let activeOutput = "";
  let activeError = "";
  activeWorker.stdout.setEncoding("utf8").on("data", (chunk) => (activeOutput += chunk));
  activeWorker.stderr.setEncoding("utf8").on("data", (chunk) => (activeError += chunk));
  const activeExitPromise = waitForClose(activeWorker);
  await waitForHeartbeat("running");
  const runningHeartbeat = readHeartbeat();
  assert.equal(runningHeartbeat?.busy, 0, "Idle worker reports that it is not busy.");
  const activeExit = await activeExitPromise;
  assert.equal(activeExit.code, 0, `Worker shutdown failed: ${activeError || activeOutput}`);
  assert.equal(
    readHeartbeat()?.state,
    "stopped",
    "Graceful worker exit records a stopped heartbeat.",
  );

  console.log(
    "✓ Workbench worker starts, reports an idle heartbeat, and records a clean stop without API calls.",
  );
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
