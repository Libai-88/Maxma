/**
 * docintel/store.ts — 本地文档索引的 SQLite 存储（独立库，不塞进 maxma.db）。
 *
 * 设计口径与 codeintel 一致：索引是可丢弃、可重建的派生物，独立库便于清空、
 * 重建和容量治理。默认落在 `<data>/api/data/doc-index.db`，测试可用
 * `MAXMA_DOC_INDEX_DB` 覆盖。
 *
 * 与代码索引的区别：文档按“来源坐标”切块（PDF 页、DOCX 段落、XLSX 工作表行、
 * 文本行），所以文件元信息和块分开存：删除/重建一个文件时，先按 path 清掉
 * 旧块与 FTS 行，再整文件替换，避免半旧半新。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Database } from "bun:sqlite";

export interface DocLocator {
  /** PDF：页码，1-based */
  page?: number;
  /** PDF：同页内第几块，0-based */
  part?: number;
  /** DOCX：段落范围，1-based，含端点 */
  paragraphs?: [number, number];
  /** XLSX：工作表名 */
  sheet?: string;
  /** XLSX：行范围，1-based，含端点 */
  rows?: [number, number];
  /** XLSX：单元格范围，如 A1:D12 */
  cells?: string;
  /** 文本：行范围，1-based，含端点 */
  lines?: [number, number];
}

export interface DocSourceBlock {
  text: string;
  locator: DocLocator;
  locatorLabel: string;
}

export interface DocIndexRootRow {
  root: string;
  label: string;
  indexedAt: number | null;
  status: "idle" | "indexing" | "ready" | "error" | "cancelled";
  fileCount: number;
  chunkCount: number;
  unsupportedCount: number;
  error: string | null;
  warnings: string[];
  progress: number;
}

export interface DocFileRow {
  path: string;
  root: string;
  relPath: string;
  format: string;
  mtimeMs: number;
  size: number;
  sha256: string;
  indexedAt: number;
  chunkCount: number;
  status: "indexed" | "unsupported" | "error";
  error: string | null;
}

export function docIndexDbPath(override?: string): string {
  if (override) return path.resolve(override);
  const explicit = process.env.MAXMA_DOC_INDEX_DB;
  if (explicit) return path.resolve(explicit);
  const dataRoot = process.env.MAXMA_DATA_DIR
    ? path.resolve(process.env.MAXMA_DATA_DIR)
    : path.resolve(process.cwd());
  return path.join(dataRoot, "api", "data", "doc-index.db");
}

export function openDocIndexDb(dbPath = docIndexDbPath()): Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");
  ensureSchema(db);
  return db;
}

function ensureSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS doc_index_roots (
      root TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      indexed_at INTEGER,
      status TEXT NOT NULL DEFAULT 'idle',
      file_count INTEGER NOT NULL DEFAULT 0,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      unsupported_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      warnings_json TEXT NOT NULL DEFAULT '[]',
      progress REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS doc_index_files (
      path TEXT PRIMARY KEY,
      root TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT '',
      mtime_ms INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '',
      indexed_at INTEGER NOT NULL DEFAULT 0,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'indexed',
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_doc_index_files_root ON doc_index_files(root, rel_path);
    CREATE TABLE IF NOT EXISTS doc_index_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      root TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT '',
      locator_json TEXT NOT NULL DEFAULT '{}',
      locator_label TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      source_text TEXT NOT NULL DEFAULT '',
      indexed_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_doc_index_chunks_path ON doc_index_chunks(path, id);
    CREATE INDEX IF NOT EXISTS idx_doc_index_chunks_root ON doc_index_chunks(root, id);
    CREATE VIRTUAL TABLE IF NOT EXISTS doc_index_fts USING fts5(
      path UNINDEXED,
      rel_path UNINDEXED,
      locator_label UNINDEXED,
      content,
      tokenize='unicode61'
    );
  `);
}

export function readRootRow(db: Database, root: string): DocIndexRootRow | null {
  const row = db
    .query(
      "SELECT root, label, indexed_at, status, file_count, chunk_count, unsupported_count, error, warnings_json, progress FROM doc_index_roots WHERE root = ?",
    )
    .get(root) as Record<string, unknown> | null;
  if (!row) return null;
  return {
    root: String(row.root),
    label: String(row.label ?? ""),
    indexedAt: typeof row.indexed_at === "number" ? row.indexed_at : null,
    status: String(row.status ?? "idle") as DocIndexRootRow["status"],
    fileCount: Number(row.file_count ?? 0),
    chunkCount: Number(row.chunk_count ?? 0),
    unsupportedCount: Number(row.unsupported_count ?? 0),
    error: typeof row.error === "string" ? row.error : null,
    warnings: parseWarnings(row.warnings_json),
    progress: Number(row.progress ?? 0),
  };
}

function parseWarnings(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function listRootRows(db: Database): DocIndexRootRow[] {
  return (db.query("SELECT root FROM doc_index_roots ORDER BY root").all() as Array<{ root: string }>)
    .map((row) => readRootRow(db, row.root))
    .filter((row): row is DocIndexRootRow => row !== null);
}

export function writeRootRow(db: Database, row: DocIndexRootRow): void {
  db.query(`
    INSERT INTO doc_index_roots
      (root, label, indexed_at, status, file_count, chunk_count, unsupported_count, error, warnings_json, progress)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(root) DO UPDATE SET
      label = excluded.label,
      indexed_at = excluded.indexed_at,
      status = excluded.status,
      file_count = excluded.file_count,
      chunk_count = excluded.chunk_count,
      unsupported_count = excluded.unsupported_count,
      error = excluded.error,
      warnings_json = excluded.warnings_json,
      progress = excluded.progress
  `).run(
    row.root,
    row.label,
    row.indexedAt,
    row.status,
    row.fileCount,
    row.chunkCount,
    row.unsupportedCount,
    row.error,
    JSON.stringify(row.warnings.slice(0, 200)),
    row.progress,
  );
}

/** 文件快速跳过用的指纹；只读元信息，不读内容。 */
export function getFileMeta(
  db: Database,
  absolutePath: string,
): { mtimeMs: number; size: number; sha256: string; status: string } | null {
  const row = db
    .query("SELECT mtime_ms, size, sha256, status FROM doc_index_files WHERE path = ?")
    .get(absolutePath) as { mtime_ms?: number; size?: number; sha256?: string; status?: string } | null;
  if (!row) return null;
  return {
    mtimeMs: Number(row.mtime_ms ?? 0),
    size: Number(row.size ?? 0),
    sha256: String(row.sha256 ?? ""),
    status: String(row.status ?? "indexed"),
  };
}

/** 单文件写入（调用方负责事务）；文件元信息、块与 FTS 一起替换。 */
export function upsertFile(db: Database, file: DocFileRow, blocks: DocSourceBlock[]): number {
  db.query("DELETE FROM doc_index_fts WHERE path = ?").run(file.path);
  db.query("DELETE FROM doc_index_chunks WHERE path = ?").run(file.path);
  db.query(`
    INSERT INTO doc_index_files
      (path, root, rel_path, format, mtime_ms, size, sha256, indexed_at, chunk_count, status, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      root = excluded.root,
      rel_path = excluded.rel_path,
      format = excluded.format,
      mtime_ms = excluded.mtime_ms,
      size = excluded.size,
      sha256 = excluded.sha256,
      indexed_at = excluded.indexed_at,
      chunk_count = excluded.chunk_count,
      status = excluded.status,
      error = excluded.error
  `).run(
    file.path,
    file.root,
    file.relPath,
    file.format,
    file.mtimeMs,
    file.size,
    file.sha256,
    file.indexedAt,
    blocks.length,
    file.status,
    file.error,
  );
  let count = 0;
  for (const block of blocks) {
    if (!block.text.trim()) continue;
    const inserted = db.query(`
      INSERT INTO doc_index_chunks
        (path, root, rel_path, format, locator_json, locator_label, text, source_text, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      file.path,
      file.root,
      file.relPath,
      file.format,
      JSON.stringify(block.locator),
      block.locatorLabel,
      ftsText(block.text),
      block.text,
      file.indexedAt,
    );
    const chunkId = Number(inserted.lastInsertRowid);
    db.query("INSERT INTO doc_index_fts (rowid, path, rel_path, locator_label, content) VALUES (?, ?, ?, ?, ?)").run(
      chunkId,
      file.path,
      file.relPath,
      block.locatorLabel,
      ftsText(block.text),
    );
    count += 1;
  }
  return count;
}

/** 把 CJK 字符拆成单字 token，让 FTS5 能对中文短语做相邻匹配；英文/数字保持原词。 */
export function ftsText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu, " $1 ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function deleteFile(db: Database, absolutePath: string): void {
  db.query("DELETE FROM doc_index_fts WHERE path = ?").run(absolutePath);
  db.query("DELETE FROM doc_index_chunks WHERE path = ?").run(absolutePath);
  db.query("DELETE FROM doc_index_files WHERE path = ?").run(absolutePath);
}

export function knownPathsForRoot(db: Database, root: string): string[] {
  return (
    db.query("SELECT path FROM doc_index_files WHERE root = ?").all(root) as Array<{ path: string }>
  ).map((row) => row.path);
}

export function clearRoot(db: Database, root: string): void {
  for (const absolutePath of knownPathsForRoot(db, root)) deleteFile(db, absolutePath);
  db.query("DELETE FROM doc_index_roots WHERE root = ?").run(root);
}

export function rootStats(db: Database, root: string): { fileCount: number; chunkCount: number; unsupportedCount: number } {
  const files = db
    .query("SELECT status, COUNT(*) AS count, COALESCE(SUM(chunk_count), 0) AS chunks FROM doc_index_files WHERE root = ? GROUP BY status")
    .all(root) as Array<{ status?: string; count?: number; chunks?: number }>;
  let fileCount = 0;
  let chunkCount = 0;
  let unsupportedCount = 0;
  for (const row of files) {
    const status = String(row.status ?? "indexed");
    const count = Number(row.count ?? 0);
    const chunks = Number(row.chunks ?? 0);
    if (status === "indexed") {
      fileCount += count;
      chunkCount += chunks;
    } else if (status === "unsupported") {
      unsupportedCount += count;
    }
  }
  return { fileCount, chunkCount, unsupportedCount };
}
