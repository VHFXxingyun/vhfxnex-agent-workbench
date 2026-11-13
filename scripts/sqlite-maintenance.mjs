import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";
import Database from "better-sqlite3";
import { resolveDatabasePath } from "../src/lib/database-path.mjs";

nextEnv.loadEnvConfig(process.cwd());

const defaultDatabasePath = resolveDatabasePath();
const defaultBackupDirectory = path.join(process.cwd(), "backups");

function timestamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

export function verifyDatabaseFile(filePath) {
  const resolvedPath = path.resolve(filePath);
  const database = new Database(resolvedPath, { readonly: true, fileMustExist: true });
  try {
    const integrity = database.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error(`SQLite 完整性校验失败：${String(integrity)}`);

    const tables = new Set(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name),
    );
    const missingTables = ["users", "workspaces"].filter((name) => !tables.has(name));
    if (missingTables.length > 0) {
      throw new Error(`备份缺少必要数据表：${missingTables.join(", ")}`);
    }
    return { path: resolvedPath, integrity: "ok" };
  } finally {
    database.close();
  }
}

async function createSnapshot(sourcePath, destinationPath) {
  const temporaryPath = `${destinationPath}.${randomUUID()}.tmp`;
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(temporaryPath);
  } finally {
    source.close();
  }

  try {
    verifyDatabaseFile(temporaryPath);
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, destinationPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return destinationPath;
}

export async function createDatabaseBackup({
  databasePath = defaultDatabasePath,
  backupDirectory = defaultBackupDirectory,
  prefix = "vhfxnex",
} = {}) {
  const sourcePath = path.resolve(databasePath);
  const targetDirectory = path.resolve(backupDirectory);
  await mkdir(targetDirectory, { recursive: true });
  const destinationPath = path.join(
    targetDirectory,
    `${prefix}-${timestamp()}-${randomUUID().slice(0, 8)}.sqlite`,
  );
  if (sourcePath === destinationPath) throw new Error("备份目标不能覆盖当前数据库。");
  await createSnapshot(sourcePath, destinationPath);
  return destinationPath;
}

async function replaceDatabaseFile(temporaryPath, databasePath) {
  try {
    await rename(temporaryPath, databasePath);
    return;
  } catch (error) {
    const target = await stat(databasePath).catch(() => null);
    if (!target?.isFile()) throw error;
  }

  const previousPath = `${databasePath}.${randomUUID()}.previous`;
  await rename(databasePath, previousPath);
  try {
    await rename(temporaryPath, databasePath);
  } catch (error) {
    await rename(previousPath, databasePath);
    throw error;
  }
  await rm(previousPath, { force: true });
}

export async function restoreDatabaseBackup({
  backupPath,
  databasePath = defaultDatabasePath,
  backupDirectory = defaultBackupDirectory,
  confirmOffline = false,
} = {}) {
  if (!confirmOffline) {
    throw new Error("恢复前必须停止 Web 服务和后台 worker，并传入 --confirm-offline。");
  }
  if (!backupPath) throw new Error("请提供备份文件路径。");

  const sourcePath = path.resolve(backupPath);
  const targetPath = path.resolve(databasePath);
  if (sourcePath === targetPath) throw new Error("备份文件不能与目标数据库相同。");
  verifyDatabaseFile(sourcePath);

  await mkdir(path.dirname(targetPath), { recursive: true });
  await mkdir(path.resolve(backupDirectory), { recursive: true });

  let safetyBackupPath = null;
  const existingTarget = await stat(targetPath).catch(() => null);
  if (existingTarget?.isFile()) {
    safetyBackupPath = await createDatabaseBackup({
      databasePath: targetPath,
      backupDirectory,
      prefix: "vhfxnex-before-restore",
    });
  }

  const temporaryPath = `${targetPath}.${randomUUID()}.restore`;
  try {
    await copyFile(sourcePath, temporaryPath, constants.COPYFILE_EXCL);
    verifyDatabaseFile(temporaryPath);
    await chmod(temporaryPath, 0o600);
    await rm(`${targetPath}-wal`, { force: true });
    await rm(`${targetPath}-shm`, { force: true });
    await replaceDatabaseFile(temporaryPath, targetPath);
    verifyDatabaseFile(targetPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }

  return { databasePath: targetPath, safetyBackupPath };
}

async function main(args) {
  const [command, ...commandArgs] = args;
  const backupDirectory = process.env.GOALFLOW_BACKUP_DIR || defaultBackupDirectory;

  if (command === "backup") {
    const destination = await createDatabaseBackup({
      backupDirectory: commandArgs[0] || backupDirectory,
    });
    console.log(`SQLite 备份已创建并通过完整性校验：${destination}`);
    return;
  }

  if (command === "verify") {
    if (!commandArgs[0]) throw new Error("用法：sqlite-maintenance.mjs verify <备份文件>");
    const result = verifyDatabaseFile(commandArgs[0]);
    console.log(`SQLite 备份校验通过：${result.path}`);
    return;
  }

  if (command === "restore") {
    const backupPath = commandArgs.find((argument) => !argument.startsWith("--"));
    const result = await restoreDatabaseBackup({
      backupPath,
      backupDirectory,
      confirmOffline: commandArgs.includes("--confirm-offline"),
    });
    console.log(`SQLite 数据库已恢复：${result.databasePath}`);
    if (result.safetyBackupPath) {
      console.log(`恢复前数据库的安全备份：${result.safetyBackupPath}`);
    }
    return;
  }

  throw new Error(
    "用法：sqlite-maintenance.mjs <backup [目录]|verify <备份文件>|restore <备份文件> --confirm-offline>",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : "SQLite 维护操作失败。");
    process.exitCode = 1;
  });
}
