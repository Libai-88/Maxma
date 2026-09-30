/**
 * db/core.ts — SQLite 核心（api/db/core.py 的 Bun 直译，阶段二 2.2）。
 *
 * 与 Python 版共享同一个 maxma.db：schema 迁移 SQL 原样保留（v1-v7），
 * WAL + busy_timeout 5000 + foreign_keys ON；迁移幂等（列存在检查）。
 * bun:sqlite 为同步 API，无需线程锁（单线程事件循环）。
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Database } from "bun:sqlite";

import { getApiDataDir } from "../app-paths";

export function dbDir(): string {
  return getApiDataDir();
}

export function dbPath(): string {
  return path.join(getApiDataDir(), "maxma.db");
}

export const SCHEMA_VERSION = 7;

type Migration = string | ((conn: Database) => void);

function migrateV3AddPriority(conn: Database): void {
  // v3：providers 表新增 priority 列（幂等）
  const cols = (conn.query("PRAGMA table_info(providers)").all() as Array<{ name: string }>).map(
    (r) => r.name,
  );
  if (!cols.includes("priority")) {
    conn.exec("ALTER TABLE providers ADD COLUMN priority INTEGER NOT NULL DEFAULT 0");
  }
  conn.exec(
    "INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (3, julianday('now'))",
  );
}

function migrateV6AddClaimToken(conn: Database): void {
  // v6：automations 表新增 claim_token 列（幂等）
  const cols = (conn.query("PRAGMA table_info(automations)").all() as Array<{ name: string }>).map(
    (r) => r.name,
  );
  if (!cols.includes("claim_token")) {
    conn.exec("ALTER TABLE automations ADD COLUMN claim_token TEXT DEFAULT NULL");
  }
  conn.exec(
    "INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (6, julianday('now'))",
  );
}

export const SCHEMA_MIGRATIONS: Migration[] = [
  // v1: 初始 schema
  `CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at REAL NOT NULL DEFAULT (julianday('now'))
    );
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      provider_type TEXT NOT NULL DEFAULT 'openai',
      label TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL DEFAULT '',
      models TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      context_window INTEGER NOT NULL DEFAULT 256000,
      created_at REAL NOT NULL DEFAULT (julianday('now')),
      updated_at REAL NOT NULL DEFAULT (julianday('now'))
    );
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL,
      created_at REAL NOT NULL DEFAULT (julianday('now'))
    );
    CREATE TABLE IF NOT EXISTS event_hooks (
      hook_id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      hook_type TEXT NOT NULL DEFAULT '',
      config TEXT NOT NULL DEFAULT '{}',
      action TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at REAL NOT NULL DEFAULT (julianday('now')),
      last_triggered REAL,
      trigger_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS const_sessions (
      session_id TEXT PRIMARY KEY,
      const_name TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      messages BLOB,
      created_at REAL NOT NULL DEFAULT (julianday('now'))
    );
    CREATE TABLE IF NOT EXISTS path_whitelist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      recursive INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS maxma_blocker (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    );
    INSERT OR IGNORE INTO schema_version (version, applied_at)
    VALUES (1, julianday('now'));`,
  // v2: 运行时指标持久化
  `CREATE TABLE IF NOT EXISTS metrics_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      uptime_seconds REAL,
      http_json TEXT,
      tools_json TEXT,
      llm_json TEXT,
      errors_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_snapshots_ts ON metrics_snapshots(timestamp);
    CREATE TABLE IF NOT EXISTS metrics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      event_type TEXT NOT NULL,
      name TEXT,
      latency_ms REAL,
      status TEXT,
      extra_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_events_type_ts ON metrics_events(event_type, timestamp);
    INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (2, julianday('now'));`,
  // v3: providers.priority（幂等函数迁移）
  migrateV3AddPriority,
  // v4: 自动化调度器
  `CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      cron_expr TEXT,
      interval_seconds INTEGER,
      action TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run TEXT,
      next_run TEXT,
      run_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS automation_run_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      automation_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      result TEXT,
      FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_automation_history_automation_id
      ON automation_run_history(automation_id, started_at DESC);
    INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (4, julianday('now'));`,
  // v5: 协作功能
  `CREATE TABLE IF NOT EXISTS collab_shares (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      share_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      expires_at TEXT,
      revoked INTEGER NOT NULL DEFAULT 0,
      permission TEXT NOT NULL DEFAULT 'read',
      created_by TEXT NOT NULL DEFAULT 'current_user',
      password_protected INTEGER NOT NULL DEFAULT 0,
      access_count INTEGER NOT NULL DEFAULT 0,
      max_access INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_collab_shares_session ON collab_shares(session_id);
    CREATE TABLE IF NOT EXISTS collab_snapshots (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      turn_count INTEGER NOT NULL DEFAULT 0,
      context_usage TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_collab_snapshots_session ON collab_snapshots(session_id);
    INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (5, julianday('now'));`,
  // v6: 自动化原子认领
  migrateV6AddClaimToken,
  // v7: 后台子任务持久化
  `CREATE TABLE IF NOT EXISTS deferred_runs (
      session_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      updated_at REAL NOT NULL DEFAULT (julianday('now')),
      PRIMARY KEY (session_id, run_id)
    );
    CREATE INDEX IF NOT EXISTS idx_deferred_runs_session ON deferred_runs(session_id);
    INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (7, julianday('now'));`,
];

let initializedForPath: string | null = null;

/** 获取一个新连接（WAL + busy_timeout + foreign_keys，与 Python 版一致）。 */
export function getConnection(): Database {
  const db = new Database(dbPath());
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");
  db.exec("PRAGMA foreign_keys=ON");
  return db;
}

/** 初始化数据库：确保目录存在、按版本运行迁移（幂等；按 dbPath 失效重跑）。 */
export function initializeDatabase(): void {
  const currentPath = dbPath();
  if (initializedForPath === currentPath) return;
  fs.mkdirSync(dbDir(), { recursive: true });
  const conn = getConnection();
  try {
    const tableExists =
      conn
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
        .get() !== null;

    if (!tableExists) {
      for (const migration of SCHEMA_MIGRATIONS) {
        applyMigration(conn, migration);
      }
      console.info(`[db] Initialized new database at ${dbPath()}`);
    } else {
      const current = (
        conn.query("SELECT MAX(version) AS v FROM schema_version").get() as { v: number | null }
      ).v ?? 0;
      if (current < SCHEMA_VERSION) {
        for (const migration of SCHEMA_MIGRATIONS.slice(current)) {
          applyMigration(conn, migration);
        }
        console.info(`[db] Migrated from v${current} to v${SCHEMA_VERSION}`);
      }
    }
    initializedForPath = currentPath;
    console.info(`[db] Database ready at ${dbPath()} (v${SCHEMA_VERSION})`);
  } finally {
    conn.close();
  }
}

function applyMigration(conn: Database, migration: Migration): void {
  if (typeof migration === "function") {
    migration(conn);
  } else {
    conn.exec(migration);
  }
}

/**
 * 事务执行：fn 内的所有写要么全提交要么全回滚（对齐 Python transaction()）。
 * 返回 fn 的返回值。
 */
export function withTransaction<T>(fn: (db: Database) => T): T {
  const conn = getConnection();
  try {
    conn.exec("BEGIN");
    const result = fn(conn);
    conn.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      conn.exec("ROLLBACK");
    } catch {
      // 连接可能已处于回滚状态
    }
    throw err;
  } finally {
    conn.close();
  }
}

/** 测试辅助：重置初始化标志（切临时数据目录后需重新迁移）。 */
export function resetDbInitForTest(): void {
  initialized = false;
}
