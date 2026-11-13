import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { resolveDatabasePath } from "../src/lib/database-path.mjs";
import {
  createDatabaseBackup,
  restoreDatabaseBackup,
  verifyDatabaseFile,
} from "./sqlite-maintenance.mjs";

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "vhfxnex-sqlite-smoke-"));
const databasePath = path.join(temporaryDirectory, "data", "goalflow.sqlite");
const backupDirectory = path.join(temporaryDirectory, "backups");

assert.equal(
  resolveDatabasePath(path.join("custom", "goalflow.sqlite"), temporaryDirectory),
  path.join(temporaryDirectory, "custom", "goalflow.sqlite"),
);
assert.equal(
  resolveDatabasePath(undefined, temporaryDirectory),
  path.join(temporaryDirectory, "data", "goalflow.sqlite"),
);

try {
  await mkdir(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE workspaces (id TEXT PRIMARY KEY, title TEXT NOT NULL);
  `);
  database.prepare("INSERT INTO users (id) VALUES (?)").run("fixture-user");
  database.prepare("INSERT INTO workspaces (id, title) VALUES (?, ?)").run("first", "备份时的数据");

  const backupPath = await createDatabaseBackup({ databasePath, backupDirectory });
  database.close();
  verifyDatabaseFile(backupPath);

  const corruptPath = path.join(temporaryDirectory, "corrupt.sqlite");
  await writeFile(corruptPath, "not a SQLite database");
  assert.throws(() => verifyDatabaseFile(corruptPath));

  const changedDatabase = new Database(databasePath);
  changedDatabase
    .prepare("INSERT INTO workspaces (id, title) VALUES (?, ?)")
    .run("second", "恢复前新增的数据");
  changedDatabase.close();

  await assert.rejects(
    restoreDatabaseBackup({ backupPath, databasePath, backupDirectory }),
    /confirm-offline/,
  );
  const result = await restoreDatabaseBackup({
    backupPath,
    databasePath,
    backupDirectory,
    confirmOffline: true,
  });

  const restoredDatabase = new Database(databasePath, { readonly: true });
  const restoredRows = restoredDatabase.prepare("SELECT id, title FROM workspaces").all();
  restoredDatabase.close();
  assert.deepEqual(restoredRows, [{ id: "first", title: "备份时的数据" }]);
  assert.ok(result.safetyBackupPath);
  verifyDatabaseFile(result.safetyBackupPath);

  const safetyDatabase = new Database(result.safetyBackupPath, { readonly: true });
  const safetyRowCount = safetyDatabase
    .prepare("SELECT COUNT(*) AS count FROM workspaces")
    .get().count;
  safetyDatabase.close();
  assert.equal(safetyRowCount, 2);

  console.log(
    "SQLite backup, integrity validation, offline guard, restore and rollback snapshot: passed.",
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
