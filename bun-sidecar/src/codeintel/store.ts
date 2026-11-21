/**
 * codeintel/store.ts — 本地代码索引的 SQLite 存储（独立库，不塞进 maxma.db）。
 *
 * 为什么独立成库：索引是可丢弃、可重建的派生物，体积可能远大于业务库；
 * 放进 maxma.db 会让“清索引”与业务迁移、备份、WAL 争用纠缠在一起。
 * 默认落在 `<data>/api/data/code-index.db`，测试用 MAXMA_CODE_INDEX_DB 覆盖。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Database } from "bun:sqlite";

import type { CodeSymbol } from "./symbols";

export interface IndexedFileRow {
  path: string;
  root: string;
  relPath: string;
  language: string;
  mtimeMs: number;
  size: number;
  sha256: string;
  content: string;
  symbols: CodeSymbol[];
  indexedAt: number;
}

export interface IndexRootRow {
  root: string;
  label: string;
  indexedAt: number | null;
  status: "idle" | "indexing" | "ready" | "error" | "cancelled";
  fileCount: number;
  error: string | null;
  progress: number;
}

export function codeIndexDbPath(override?: string): string {
  if (override) return path.resolve(override);
  const explicit = process.env.MAXMA_CODE_INDEX_DB;
  if (explicit) return path.resolve(explicit);
  const dataRoot = process.env.MAXMA_DATA_DIR
    ? path.resolve(process.env.MAXMA_DATA_DIR)
    : path.resolve(process.cwd());
  return path.join(dataRoot, "api", "data", "code-index.db");
}

export function openCodeIndexDb(dbPath = codeIndexDbPath()): Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");
  ensureSchema(db);
  return db;
}

function ensureSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS code_index_roots (
      root TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      indexed_at INTEGER,
      status TEXT NOT NULL DEFAULT 'idle',
      file_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      progress REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS code_index_files (
      path TEXT PRIMARY KEY,
      root TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT '',
      mtime_ms INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      symbols_json TEXT NOT NULL DEFAULT '[]',
      indexed_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_code_index_files_root ON code_index_files(root, rel_path);
    CREATE TABLE IF NOT EXISTS code_index_symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_lower TEXT NOT NULL,
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      line INTEGER NOT NULL,
      column INTEGER NOT NULL,
      container TEXT,
      signature TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_code_index_symbols_name ON code_index_symbols(name_lower);
    CREATE INDEX IF NOT EXISTS idx_code_index_symbols_path ON code_index_symbols(path, line);
    CREATE VIRTUAL TABLE IF NOT EXISTS code_index_fts USING fts5(
      path UNINDEXED,
      rel_path UNINDEXED,
      content,
      tokenize='unicode61'
    );
  `);
}

export function readRootRow(db: Database, root: string): IndexRootRow | null {
  const row = db.query("SELECT root, label, indexed_at, status, file_count, error, progress FROM code_index_roots WHERE root = ?")
    .get(root) as Record<string, unknown> | null;
  if (!row) return null;
  return {
    root: String(row.root),
    label: String(row.label ?? ""),
    indexedAt: typeof row.indexed_at === "number" ? row.indexed_at : null,
    status: String(row.status ?? "idle") as IndexRootRow["status"],
    fileCount: Number(row.file_count ?? 0),
    error: typeof row.error === "string" ? row.error : null,
    progress: Number(row.progress ?? 0),
  };
}

export function listRootRows(db: Database): IndexRootRow[] {
  return (db.query("SELECT root FROM code_index_roots ORDER BY root").all() as Array<{ root: string }>)
    .map((row) => readRootRow(db, row.root))
    .filter((row): row is IndexRootRow => row !== null);
}

export function writeRootRow(db: Database, row: IndexRootRow): void {
  db.query(`
    INSERT INTO code_index_roots (root, label, indexed_at, status, file_count, error, progress)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(root) DO UPDATE SET
      label = excluded.label,
      indexed_at = excluded.indexed_at,
      status = excluded.status,
      file_count = excluded.file_count,
      error = excluded.error,
      progress = excluded.progress
  `).run(
    row.root,
    row.label,
    row.indexedAt,
    row.status,
    row.fileCount,
    row.error,
    row.progress,
  );
}

export function getFileMeta(db: Database, absolutePath: string): { mtimeMs: number; size: number; sha256: string } | null {
  const row = db.query("SELECT mtime_ms, size, sha256 FROM code_index_files WHERE path = ?").get(absolutePath) as
    | { mtime_ms?: number; size?: number; sha256?: string }
    | null;
  if (!row) return null;
  return {
    mtimeMs: Number(row.mtime_ms ?? 0),
    size: Number(row.size ?? 0),
    sha256: String(row.sha256 ?? ""),
  };
}

/** 单文件写入（调用方负责事务）；FTS 与符号表一起替换，避免半旧半新。 */
export function upsertFile(db: Database, file: IndexedFileRow): void {
  db.query(`
    INSERT INTO code_index_files (path, root, rel_path, language, mtime_ms, size, sha256, content, symbols_json, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      root = excluded.root,
      rel_path = excluded.rel_path,
      language = excluded.language,
      mtime_ms = excluded.mtime_ms,
      size = excluded.size,
      sha256 = excluded.sha256,
      content = excluded.content,
      symbols_json = excluded.symbols_json,
      indexed_at = excluded.indexed_at
  `).run(
    file.path,
    file.root,
    file.relPath,
    file.language,
    file.mtimeMs,
    file.size,
    file.sha256,
    file.content,
    JSON.stringify(file.symbols),
    file.indexedAt,
  );
  db.query("DELETE FROM code_index_fts WHERE path = ?").run(file.path);
  db.query("INSERT INTO code_index_fts (path, rel_path, content) VALUES (?, ?, ?)").run(file.path, file.relPath, file.content);
  db.query("DELETE FROM code_index_symbols WHERE path = ?").run(file.path);
  for (const symbol of file.symbols) {
    db.query(`
      INSERT INTO code_index_symbols (name, name_lower, kind, path, rel_path, line, column, container, signature)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      symbol.name,
      symbol.name.toLowerCase(),
      symbol.kind,
      file.path,
      file.relPath,
      symbol.line,
      symbol.column,
      symbol.container ?? null,
      symbol.signature ?? null,
    );
  }
}

export function deleteFile(db: Database, absolutePath: string): void {
  db.query("DELETE FROM code_index_files WHERE path = ?").run(absolutePath);
  db.query("DELETE FROM code_index_fts WHERE path = ?").run(absolutePath);
  db.query("DELETE FROM code_index_symbols WHERE path = ?").run(absolutePath);
}

export function knownPathsForRoot(db: Database, root: string): string[] {
  return (db.query("SELECT path FROM code_index_files WHERE root = ?").all(root) as Array<{ path: string }>)
    .map((row) => row.path);
}

export function clearRoot(db: Database, root: string): void {
  for (const absolutePath of knownPathsForRoot(db, root)) deleteFile(db, absolutePath);
  db.query("DELETE FROM code_index_roots WHERE root = ?").run(root);
}
