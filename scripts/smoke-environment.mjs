import nextEnv from "@next/env";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveDatabasePath } from "../src/lib/database-path.mjs";
import { isSessionSecretValid } from "../src/lib/session-secret.mjs";
import { createSmokeDatabaseProof } from "../src/lib/smoke-database-proof.mjs";

const { loadEnvConfig } = nextEnv;
const explicitlyConfiguredDatabasePath = process.env.GOALFLOW_DATABASE_PATH;
const explicitlyConfiguredBaseUrl = process.env.NEXORA_BASE_URL;

function isInsideDirectory(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function requireIsolatedSmokeConfiguration() {
  if (!explicitlyConfiguredDatabasePath) {
    throw new Error(
      "拒绝运行 smoke：请在启动服务和烟测命令的两个终端都显式设置临时 GOALFLOW_DATABASE_PATH，避免访问默认工作区数据库。",
    );
  }
  const databasePath = resolveDatabasePath(explicitlyConfiguredDatabasePath);
  const allowedRoots = [os.tmpdir(), process.env.RUNNER_TEMP]
    .filter(Boolean)
    .map((root) => path.resolve(root));
  let canonicalDatabasePath;
  let canonicalAllowedRoots;
  try {
    canonicalDatabasePath = fs.realpathSync.native(databasePath);
    canonicalAllowedRoots = allowedRoots.map((root) => fs.realpathSync.native(root));
  } catch {
    throw new Error(
      "拒绝运行 smoke：隔离 SQLite 文件必须已由专用测试服务创建；请先启动使用临时数据库的服务。",
    );
  }
  if (
    !fs.statSync(canonicalDatabasePath).isFile() ||
    !canonicalAllowedRoots.some((root) => isInsideDirectory(root, canonicalDatabasePath))
  ) {
    throw new Error("拒绝运行 smoke：GOALFLOW_DATABASE_PATH 实际解析后不在系统或 CI 临时目录中。");
  }
  if (!explicitlyConfiguredBaseUrl) {
    throw new Error(
      "拒绝运行 smoke：请显式设置 NEXORA_BASE_URL，确认烟测不会连接默认端口上的其他工作区服务。",
    );
  }
  const baseUrl = new URL(explicitlyConfiguredBaseUrl);
  if (
    baseUrl.protocol !== "http:" ||
    !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(baseUrl.hostname)
  ) {
    throw new Error("拒绝运行 smoke：目标服务必须是显式指定的本机 HTTP 回环地址。");
  }
  process.env.GOALFLOW_DATABASE_PATH = databasePath;
  process.env.NEXORA_BASE_URL = baseUrl.href;
  return { databasePath, baseUrl };
}

/**
 * Load project-local runtime settings for test clients so they use the same
 * configured SQLite path as the app. Smoke clients never need the API key;
 * the server process owns it, so remove inherited and locally loaded copies.
 */
export function loadSmokeEnvironment() {
  let isolatedConfiguration;
  try {
    isolatedConfiguration = requireIsolatedSmokeConfiguration();
  } catch (error) {
    if (error instanceof Error) error.name = "SmokeConfigurationError";
    throw error;
  }
  const liveUiRequested = process.env.NEXORA_TEST_LIVE_UI === "1";
  delete process.env.DEEPSEEK_API_KEY;
  loadEnvConfig(process.cwd());
  delete process.env.DEEPSEEK_API_KEY;
  if (liveUiRequested) process.env.NEXORA_TEST_LIVE_UI = "1";
  else delete process.env.NEXORA_TEST_LIVE_UI;
  return { liveUiRequested, ...isolatedConfiguration };
}

export function loadSmokeEnvironmentOrExit() {
  try {
    return loadSmokeEnvironment();
  } catch (error) {
    if (!(error instanceof Error) || error.name !== "SmokeConfigurationError") throw error;
    console.error(error.message);
    process.exit(1);
  }
}

export async function assertSmokeTargetMatchesDatabase(baseUrl) {
  const sessionSecret = process.env.SESSION_SECRET || "";
  if (!isSessionSecretValid(sessionSecret)) {
    throw new Error("拒绝运行 smoke：SESSION_SECRET 必须与隔离服务配置一致且至少 32 字节。");
  }
  const proof = createSmokeDatabaseProof(resolveDatabasePath(), sessionSecret);
  let response;
  try {
    response = await fetch(new URL("/api/health", baseUrl), {
      headers: {
        Accept: "application/json",
        "X-VHFXNEX-Smoke-DB-Proof": proof,
      },
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    const error = new Error(
      `无法安全连接 smoke 服务 ${baseUrl.origin}。请启动使用同一临时 SQLite 和 SESSION_SECRET 的隔离服务；未开始创建测试账号或数据库样例。`,
    );
    error.name = "SmokeServerUnavailableError";
    throw error;
  }
  const payload = await response.json().catch(() => null);
  if (response.status === 409 || payload?.reason === "database_mismatch") {
    const error = new Error(
      `拒绝对 ${baseUrl.origin} 执行 smoke：服务端 SQLite 与 GOALFLOW_DATABASE_PATH 不匹配；未开始测试写入。`,
    );
    error.name = "SmokeDatabaseMismatchError";
    throw error;
  }
  if (!response.ok || payload?.status !== "ok") {
    const error = new Error(
      `smoke 服务 ${baseUrl.origin} 尚未就绪；健康检查未通过，未开始测试写入。请确认 SQLite 和后台 worker 已启动。`,
    );
    error.name = "SmokeServerUnavailableError";
    throw error;
  }
  if (payload?.smokeDatabaseMatched !== true) {
    const error = new Error(
      `拒绝对 ${baseUrl.origin} 执行 smoke：服务端未确认测试数据库身份；请更新并重启本地服务。未开始测试写入。`,
    );
    error.name = "SmokeDatabaseMismatchError";
    throw error;
  }
}

export async function assertSmokeTargetMatchesDatabaseOrExit(baseUrl) {
  try {
    await assertSmokeTargetMatchesDatabase(baseUrl);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !["SmokeServerUnavailableError", "SmokeDatabaseMismatchError"].includes(error.name)
    ) {
      throw error;
    }
    console.error(error.message);
    process.exit(1);
  }
}
