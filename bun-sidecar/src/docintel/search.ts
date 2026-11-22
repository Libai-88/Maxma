/**
 * docintel/search.ts — 文档索引的检索与按来源坐标取回。
 *
 * 中文检索：FTS5 unicode61 不切中文，索引时把 CJK 字符拆成单字 token，
 * 查询时把中文短语折成相邻 token 的短语查询，因此“热电材料”能命中
 * “本项目研究热电材料……”；返回给调用方的仍是原始文本和原始坐标。
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { docIndexDbPath, openDocIndexDb, readRootRow, type DocLocator } from "./store";

export interface DocSearchOptions {
  root?: string;
  limit?: number;
  dbPath?: string;
}

export interface DocSearchHit {
  chunkId: number;
  path: string;
  relPath: string;
  root: string;
  format: string;
  locator: DocLocator;
  locatorLabel: string;
  snippet: string;
  rank: number;
}

export interface DocReadOptions {
  root?: string;
  page?: number;
  sheet?: string;
  paragraph?: number;
  startLine?: number;
  endLine?: number;
  limit?: number;
  dbPath?: string;
}

export interface DocReadChunk {
  chunkId: number;
  relPath: string;
  format: string;
  locator: DocLocator;
  locatorLabel: string;
  text: string;
}

export interface DocReadResult {
  path: string;
  relPath: string;
  format: string;
  status: string;
  error: string | null;
  chunks: DocReadChunk[];
}

function normalizeRoot(root: string): string {
  try {
    return fs.realpathSync.native(path.resolve(root));
  } catch {
    return path.resolve(root);
  }
}

function queryTerms(query: string): string[] {
  const matches = query.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|[\p{L}\p{N}_$.-]{2,}/gu) ?? [];
  return matches.map((token) => token.trim()).filter(Boolean).slice(0, 8);
}

function ftsQuery(terms: string[]): string {
  if (terms.length === 0) return "";
  return terms
    .map((term) =>
      `"${term
        .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, " $& ")
        .replace(/["\n]/g, '"')
        .trim()
        .replace(/\s+/g, " ")}"`,
    )
    .filter((term) => term.length > 2)
    .join(" OR ");
}

function makeSnippet(text: string, terms: string[], radius = 90): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  let hit = -1;
  for (const term of terms) {
    const index = normalized.toLowerCase().indexOf(term.toLowerCase());
    if (index >= 0 && (hit < 0 || index < hit)) hit = index;
  }
  if (hit < 0) return normalized.slice(0, radius * 2) + (normalized.length > radius * 2 ? "…" : "");
  const start = Math.max(0, hit - radius);
  const end = Math.min(normalized.length, hit + radius);
  return `${start > 0 ? "…" : ""}${normalized.slice(start, end)}${end < normalized.length ? "…" : ""}`;
}

function parseLocator(value: unknown): DocLocator {
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    return typeof parsed === "object" && parsed !== null ? (parsed as DocLocator) : {};
  } catch {
    return {};
  }
}

export function searchDocs(query: string, options: DocSearchOptions = {}): DocSearchHit[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const match = ftsQuery(terms);
  if (!match) return [];
  const db = openDocIndexDb(options.dbPath);
  try {
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 20), 1), 100);
    const root = options.root ? normalizeRoot(options.root) : "";
    const rows = db
      .query(`
        SELECT c.id, c.path, c.rel_path, c.root, c.format, c.locator_json, c.locator_label, c.source_text,
               bm25(doc_index_fts) AS rank
        FROM doc_index_fts
        JOIN doc_index_chunks c ON c.id = doc_index_fts.rowid
        WHERE (? = '' OR c.root = ?) AND doc_index_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `)
      .all(root, root, match, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      chunkId: Number(row.id ?? 0),
      path: String(row.path ?? ""),
      relPath: String(row.rel_path ?? ""),
      root: String(row.root ?? ""),
      format: String(row.format ?? ""),
      locator: parseLocator(row.locator_json),
      locatorLabel: String(row.locator_label ?? ""),
      snippet: makeSnippet(String(row.source_text ?? ""), terms),
      rank: Number(row.rank ?? 0),
    }));
  } catch (error) {
    if (error instanceof Error) return [];
    throw error;
  } finally {
    db.close();
  }
}

export function readDoc(filePath: string, options: DocReadOptions = {}): DocReadResult | null {
  const db = openDocIndexDb(options.dbPath);
  try {
    const root = options.root ? normalizeRoot(options.root) : "";
    let absolute = "";
    if (path.isAbsolute(filePath)) {
      absolute = path.resolve(filePath);
    } else if (root) {
      const wanted = filePath.split(path.sep).join("/");
      const row = db.query("SELECT path FROM doc_index_files WHERE root = ? AND rel_path = ?").get(root, wanted) as
        | { path?: string }
        | null;
      absolute = row?.path ? String(row.path) : path.resolve(root, filePath);
    } else {
      absolute = path.resolve(filePath);
    }
    const file = db
      .query("SELECT path, rel_path, format, status, error FROM doc_index_files WHERE path = ?")
      .get(absolute) as { path?: string; rel_path?: string; format?: string; status?: string; error?: string | null } | null;
    if (!file) return null;

    const rows = db
      .query(
        "SELECT id, rel_path, format, locator_json, locator_label, source_text FROM doc_index_chunks WHERE path = ? ORDER BY id",
      )
      .all(absolute) as Array<Record<string, unknown>>;
    const chunks: DocReadChunk[] = [];
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 6), 1), 20);
    for (const row of rows) {
      const locator = parseLocator(row.locator_json);
      if (!matchesLocator(locator, options)) continue;
      chunks.push({
        chunkId: Number(row.id ?? 0),
        relPath: String(row.rel_path ?? ""),
        format: String(row.format ?? ""),
        locator,
        locatorLabel: String(row.locator_label ?? ""),
        text: String(row.source_text ?? ""),
      });
      if (chunks.length >= limit) break;
    }
    return {
      path: absolute,
      relPath: String(file.rel_path ?? ""),
      format: String(file.format ?? ""),
      status: String(file.status ?? "indexed"),
      error: typeof file.error === "string" ? file.error : null,
      chunks,
    };
  } finally {
    db.close();
  }
}

function matchesLocator(locator: DocLocator, options: DocReadOptions): boolean {
  if (options.page !== undefined && locator.page !== options.page) return false;
  if (options.paragraph !== undefined) {
    if (!locator.paragraphs) return false;
    const [start, end] = locator.paragraphs;
    if (options.paragraph < start || options.paragraph > end) return false;
  }
  if (options.sheet !== undefined && locator.sheet !== options.sheet) return false;
  if (options.startLine !== undefined || options.endLine !== undefined) {
    if (!locator.lines) return false;
    const [start, end] = locator.lines;
    const wantedStart = options.startLine ?? start;
    const wantedEnd = options.endLine ?? end;
    if (wantedEnd < start || wantedStart > end) return false;
  }
  return true;
}

export function docIndexHasRoot(root: string, dbPath = docIndexDbPath()): boolean {
  const db = openDocIndexDb(dbPath);
  try {
    return readRootRow(db, normalizeRoot(root)) !== null;
  } finally {
    db.close();
  }
}
