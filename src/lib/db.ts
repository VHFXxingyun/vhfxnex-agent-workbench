import "server-only";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { resolveDatabasePath } from "./database-path.mjs";

const databasePath = resolveDatabasePath();
const folder = path.dirname(databasePath);
if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
const database = new Database(databasePath, { timeout: 10_000 });
database.pragma("foreign_keys = ON");
if (process.env.NEXT_PHASE !== "phase-production-build") {
  database.pragma("busy_timeout = 10000");
  database.pragma("journal_mode = WAL");
  database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    recovery_code_hash TEXT,
    role TEXT NOT NULL DEFAULT 'member',
    session_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_workspaces_user ON workspaces(user_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
    added_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, user_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS workspace_share_links (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    max_uses INTEGER NOT NULL DEFAULT 10,
    use_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_workspace_share_links_workspace
    ON workspace_share_links(workspace_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS workspace_execution_locks (
    workspace_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_workspace_execution_locks_expiry
    ON workspace_execution_locks(expires_at);
  CREATE TABLE IF NOT EXISTS workspace_execution_status (
    token TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    workspace_title TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('running', 'completed', 'failed')),
    activity TEXT NOT NULL,
    completed_tool_calls INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_workspace_execution_status_user_updated
    ON workspace_execution_status(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_workspace_execution_status_workspace_state
    ON workspace_execution_status(workspace_id, state, updated_at DESC);
  CREATE TABLE IF NOT EXISTS workbench_handoffs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    instruction TEXT NOT NULL,
    user_message_id TEXT NOT NULL,
    user_message TEXT NOT NULL,
    attachments_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'cancelled')),
    claim_token TEXT,
    claim_expires_at INTEGER,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_workbench_handoffs_user_message
    ON workbench_handoffs(user_id, user_message_id);
  CREATE INDEX IF NOT EXISTS idx_workbench_handoffs_queue
    ON workbench_handoffs(user_id, status, created_at);
  CREATE TABLE IF NOT EXISTS service_heartbeats (
    service TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('starting', 'running', 'stopping', 'stopped')),
    busy INTEGER NOT NULL DEFAULT 0 CHECK (busy IN (0, 1)),
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS knowledge_documents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_knowledge_user ON knowledge_documents(user_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS knowledge_embeddings (
    knowledge_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    vector_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (knowledge_id, chunk_index),
    FOREIGN KEY (knowledge_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_user ON knowledge_embeddings(user_id);
  CREATE TABLE IF NOT EXISTS auth_rate_limits (
    key_hash TEXT PRIMARY KEY,
    window_started_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_window ON auth_rate_limits(window_started_at);
  CREATE TABLE IF NOT EXISTS ai_usage (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workspace_id TEXT,
    source TEXT NOT NULL DEFAULT 'unknown',
    operation TEXT NOT NULL CHECK (operation IN ('plan', 'execute')),
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    cached_input_tokens INTEGER NOT NULL DEFAULT 0,
    cache_measured_input_tokens INTEGER NOT NULL DEFAULT 0,
    cache_measured_hit_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_measured_requests INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL,
    total_tokens INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id, created_at DESC);
  `);
  const userColumns = database.pragma("table_info(users)") as { name: string }[];
  if (!userColumns.some((column) => column.name === "session_version")) {
    database.exec("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0");
  }
  if (!userColumns.some((column) => column.name === "recovery_code_hash")) {
    database.exec("ALTER TABLE users ADD COLUMN recovery_code_hash TEXT");
  }
  const usageColumns = database.pragma("table_info(ai_usage)") as { name: string }[];
  if (!usageColumns.some((column) => column.name === "cached_input_tokens")) {
    database.exec("ALTER TABLE ai_usage ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0");
  }
  if (!usageColumns.some((column) => column.name === "cache_measured_input_tokens")) {
    database.exec(
      "ALTER TABLE ai_usage ADD COLUMN cache_measured_input_tokens INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!usageColumns.some((column) => column.name === "cache_measured_hit_tokens")) {
    database.exec(
      "ALTER TABLE ai_usage ADD COLUMN cache_measured_hit_tokens INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!usageColumns.some((column) => column.name === "reasoning_tokens")) {
    database.exec("ALTER TABLE ai_usage ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0");
  }
  if (!usageColumns.some((column) => column.name === "reasoning_measured_requests")) {
    database.exec(
      "ALTER TABLE ai_usage ADD COLUMN reasoning_measured_requests INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!usageColumns.some((column) => column.name === "workspace_id")) {
    database.exec("ALTER TABLE ai_usage ADD COLUMN workspace_id TEXT");
  }
  if (!usageColumns.some((column) => column.name === "source")) {
    database.exec("ALTER TABLE ai_usage ADD COLUMN source TEXT NOT NULL DEFAULT 'unknown'");
    database.exec("UPDATE ai_usage SET source = 'planner' WHERE operation = 'plan'");
  }
  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_ai_usage_workspace ON ai_usage(workspace_id, created_at DESC)",
  );
  const executionStatusColumns = database.pragma("table_info(workspace_execution_status)") as {
    name: string;
  }[];
  if (!executionStatusColumns.some((column) => column.name === "cancel_requested_at")) {
    database.exec("ALTER TABLE workspace_execution_status ADD COLUMN cancel_requested_at TEXT");
  }
  const handoffColumns = database.pragma("table_info(workbench_handoffs)") as { name: string }[];
  if (!handoffColumns.some((column) => column.name === "attempt_count")) {
    database.exec(
      "ALTER TABLE workbench_handoffs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!handoffColumns.some((column) => column.name === "next_attempt_at")) {
    database.exec("ALTER TABLE workbench_handoffs ADD COLUMN next_attempt_at TEXT");
  }
  if (!handoffColumns.some((column) => column.name === "last_error")) {
    database.exec("ALTER TABLE workbench_handoffs ADD COLUMN last_error TEXT");
  }
}

export type DbUser = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  recovery_code_hash: string | null;
  role: "admin" | "member";
  session_version: number;
  created_at: string;
};
export type DbWorkspace = {
  id: string;
  user_id: string;
  title: string;
  category: string;
  body: string;
  created_at: string;
  updated_at: string;
};
export type DbKnowledge = {
  id: string;
  user_id: string;
  title: string;
  content: string;
  created_at: string;
};

export default database;
