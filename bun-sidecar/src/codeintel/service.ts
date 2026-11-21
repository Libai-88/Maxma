/**
 * codeintel/service.ts — 代码索引的构建、增量更新与查询（C1/C2/C3 的服务端主体）。
 *
 * 口径：
 *   - 索引是**派生物**：独立 SQLite 库、可清空重建，不进入业务库迁移；
 *   - 构建在后台任务里做，HTTP 请求只负责启动/查询/取消，不阻塞聊天；
 *   - 文件指纹用 mtime+size 做快速跳过，内容哈希用于“同 mtime 同 size 但内容变了”；
 *   - 所有查询只返回索引内路径，不读取工作区外文件。
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Database } from "bun:sqlite";
import * as ts from "typescript";

import { codeIndexDbPath, deleteFile, getFileMeta, knownPathsForRoot, openCodeIndexDb, readRootRow, upsertFile, writeRootRow, type IndexRootRow } from "./store";
import { extractSymbols, isCodeFile, isTypeScriptFile, type CodeSymbol } from "./symbols";

const IGNORED_DIRS = new Set([
  ".git", ".hg", ".svn", "node_modules", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit",
  "coverage", ".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
  "target", ".idea", ".vscode", ".cache", ".turbo", ".parcel-cache", ".yarn", ".pnpm-store",
  ".maxma", "vendor", "Pods", ".gradle", ".terraform",
]);
const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".py", ".go", ".rs", ".java", ".kt",
  ".swift", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".rb", ".scala", ".lua", ".dart", ".vue", ".svelte",
  ".md", ".mdx", ".txt", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
  ".css", ".scss", ".sass", ".less", ".html", ".htm", ".xml", ".sql", ".sh", ".bash", ".zsh", ".ps1",
]);
const MAX_INDEX_FILE_BYTES = 512 * 1024;
const MAX_INDEXED_CHARS = 240 * 1024;
const MAX_FILES_PER_RUN = 20_000;

interface ActiveJob {
  cancelled: boolean;
  progress: number;
  fileCount: number;
  startedAt: number;
}

const activeJobs = new Map<string, ActiveJob>();

export interface CodeIndexOptions {
  label?: string;
  force?: boolean;
  maxFiles?: number;
}

export interface CodeIndexStatus extends IndexRootRow {
  running: boolean;
  startedAt: number | null;
}

function normalizeRoot(root: string): string {
  return fs.realpathSync.native(path.resolve(root));
}

function languageOf(relativePath: string): string {
  return path.extname(relativePath).toLowerCase().replace(/^\./, "") || "text";
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function shouldIndexFile(relativePath: string, fileName: string): boolean {
  if (fileName.endsWith(".min.js") || fileName.endsWith(".min.css")) return false;
  if (fileName === "bun.lock" || fileName === "package-lock.json" || fileName === "pnpm-lock.yaml") return false;
  const extension = path.extname(relativePath).toLowerCase();
  return TEXT_EXTENSIONS.has(extension);
}

async function collectFiles(root: string, maxFiles: number, job: ActiveJob): Promise<string[]> {
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    if (job.cancelled || files.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (job.cancelled || files.length >= maxFiles) return;
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(absolute);
      } else if (entry.isFile() && shouldIndexFile(absolute, entry.name)) {
        files.push(absolute);
      }
    }
  };
  await walk(root);
  return files;
}

function rootStatus(db: Database, root: string, label: string): CodeIndexStatus {
  const row = readRootRow(db, root) ?? {
    root, label, indexedAt: null, status: "idle" as const, fileCount: 0, error: null, progress: 0,
  };
  const job = activeJobs.get(root);
  return { ...row, running: Boolean(job), startedAt: job?.startedAt ?? null };
}

export function getCodeIndexStatus(dbPath?: string, roots?: Array<{ path: string; label?: string }>): CodeIndexStatus[] {
  const db = openCodeIndexDb(dbPath);
  try {
    const wanted = roots ?? [];
    return wanted.map((item) => rootStatus(db, normalizeRoot(item.path), item.label ?? ""));
  } finally {
    db.close();
  }
}

export function startCodeIndex(
  root: string,
  options: CodeIndexOptions = {},
  dbPath = codeIndexDbPath(),
): CodeIndexStatus {
  const realRoot = normalizeRoot(root);
  const db = openCodeIndexDb(dbPath);
  try {
    if (activeJobs.has(realRoot)) return rootStatus(db, realRoot, options.label ?? "");
    const previous = readRootRow(db, realRoot);
    const job: ActiveJob = { cancelled: false, progress: 0, fileCount: 0, startedAt: Date.now() };
    activeJobs.set(realRoot, job);
    writeRootRow(db, {
      root: realRoot,
      label: options.label ?? previous?.label ?? path.basename(realRoot),
      indexedAt: previous?.indexedAt ?? null,
      status: "indexing",
      fileCount: previous?.fileCount ?? 0,
      error: null,
      progress: 0,
    });
    const status = rootStatus(db, realRoot, options.label ?? "");
    void runIndex(realRoot, options, dbPath, job);
    return status;
  } finally {
    db.close();
  }
}

async function runIndex(root: string, options: CodeIndexOptions, dbPath: string, job: ActiveJob): Promise<void> {
  const startedAt = Date.now();
  try {
    const limit = Math.min(options.maxFiles ?? MAX_FILES_PER_RUN, MAX_FILES_PER_RUN);
    const files = await collectFiles(root, limit, job);
    const completeScan = !job.cancelled && files.length < limit;
    const db = openCodeIndexDb(dbPath);
    try {
      const seen = new Set<string>();
      const previous = readRootRow(db, root);
      let indexed = 0;
      const batch: Array<{ absolute: string; relative: string; stat: fs.Stats; content: string; hash: string; symbols: CodeSymbol[] }> = [];

      const flush = db.transaction(() => {
        for (const item of batch) {
          upsertFile(db, {
            path: item.absolute,
            root,
            relPath: item.relative,
            language: languageOf(item.relative),
            mtimeMs: item.stat.mtimeMs,
            size: item.stat.size,
            sha256: item.hash,
            content: item.content,
            symbols: item.symbols,
            indexedAt: Date.now(),
          });
          seen.add(item.absolute);
        }
        batch.length = 0;
        indexed = seen.size;
        writeRootRow(db, {
          root,
          label: options.label ?? previous?.label ?? path.basename(root),
          indexedAt: previous?.indexedAt ?? null,
          status: "indexing",
          fileCount: indexed,
          error: null,
          progress: files.length > 0 ? Math.min(1, indexed / files.length) : 0,
        });
      });

      for (let index = 0; index < files.length; index += 1) {
        if (job.cancelled) break;
        const absolute = files[index];
        if (!absolute) continue;
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        const stat = await fs.promises.stat(absolute).catch(() => null);
        if (!stat?.isFile() || stat.size > MAX_INDEX_FILE_BYTES) continue;
        const previousMeta = getFileMeta(db, absolute);
        if (!options.force && previousMeta && previousMeta.mtimeMs === stat.mtimeMs && previousMeta.size === stat.size) {
          seen.add(absolute);
          continue;
        }
        const bytes = await fs.promises.readFile(absolute).catch(() => null);
        if (!bytes || bytes.includes(0)) continue;
        const content = bytes.toString("utf8");
        if (!content.trim()) continue;
        const hash = sha256(content);
        if (!options.force && previousMeta && previousMeta.sha256 === hash) {
          seen.add(absolute);
          continue;
        }
        const symbols = extractSymbols(relative, content.length > MAX_INDEXED_CHARS ? content.slice(0, MAX_INDEXED_CHARS) : content);
        batch.push({ absolute, relative, stat, content: content.length > MAX_INDEXED_CHARS ? content.slice(0, MAX_INDEXED_CHARS) : content, hash, symbols });
        if (batch.length >= 50) flush();
        job.progress = files.length > 0 ? Math.min(1, seen.size / files.length) : 1;
        if (index % 25 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (batch.length > 0 && !job.cancelled) flush();
      if (batch.length > 0) batch.length = 0;

      for (const stale of knownPathsForRoot(db, root)) {
        // 取消或达到 maxFiles 截断时，本次看到的只是部分文件；此时清 stale 会把
        // 未扫到的旧索引误删。只有完整扫描结束才允许对账删除。
        if (!completeScan) continue;
        if (!seen.has(stale)) deleteFile(db, stale);
      }
      writeRootRow(db, {
        root,
        label: options.label ?? previous?.label ?? path.basename(root),
        indexedAt: Date.now(),
        status: job.cancelled ? "cancelled" : "ready",
        fileCount: seen.size,
        error: null,
        progress: job.cancelled ? job.progress : 1,
      });
      console.info(`[code-index] ${root}: ${seen.size} files in ${Date.now() - startedAt}ms${job.cancelled ? " (cancelled)" : ""}`);
    } finally {
      db.close();
    }
  } catch (error) {
    try {
      const db = openCodeIndexDb(dbPath);
      try {
        const previous = readRootRow(db, root);
        writeRootRow(db, {
          root,
          label: options.label ?? previous?.label ?? path.basename(root),
          indexedAt: previous?.indexedAt ?? null,
          status: "error",
          fileCount: previous?.fileCount ?? 0,
          error: error instanceof Error ? error.message : String(error),
          progress: job.progress,
        });
      } finally {
        db.close();
      }
    } catch {
      /* status 写失败不能盖住真实错误 */
    }
    console.warn("[code-index] index failed:", error);
  } finally {
    activeJobs.delete(root);
  }
}

export function cancelCodeIndex(root: string, dbPath = codeIndexDbPath()): boolean {
  const realRoot = normalizeRoot(root);
  const job = activeJobs.get(realRoot);
  if (!job) return false;
  job.cancelled = true;
  return true;
}

function ftsTerms(query: string): string {
  const tokens = query.match(/[\p{L}\p{N}_$.-]{2,}/gu) ?? [];
  if (tokens.length === 0) return "";
  return tokens.slice(0, 8).map((token) => `"${token.replace(/"/g, '""')}"`).join(" OR ");
}

export interface CodeSearchHit {
  path: string;
  relPath: string;
  root: string;
  language: string;
  snippet: string;
  rank: number;
}

export function searchCode(query: string, limit = 20, dbPath = codeIndexDbPath()): CodeSearchHit[] {
  const match = ftsTerms(query);
  if (!match) return [];
  const db = openCodeIndexDb(dbPath);
  try {
    const rows = db.query(`
      SELECT f.path, f.rel_path, f.root, f.language,
             snippet(code_index_fts, 2, '<mark>', '</mark>', '…', 24) AS snippet,
             bm25(code_index_fts) AS rank
      FROM code_index_fts
      JOIN code_index_files f ON f.path = code_index_fts.path
      WHERE code_index_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(match, Math.min(Math.max(limit, 1), 100)) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      path: String(row.path),
      relPath: String(row.rel_path ?? ""),
      root: String(row.root ?? ""),
      language: String(row.language ?? ""),
      snippet: String(row.snippet ?? ""),
      rank: Number(row.rank ?? 0),
    }));
  } catch (error) {
    if (error instanceof Error) return [];
    throw error;
  } finally {
    db.close();
  }
}

export interface CodeSymbolHit extends CodeSymbol {
  path: string;
  relPath: string;
  language: string;
}

export function listSymbols(options: { path?: string; query?: string; limit?: number }, dbPath = codeIndexDbPath()): CodeSymbolHit[] {
  const db = openCodeIndexDb(dbPath);
  try {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    let rows: Array<Record<string, unknown>>;
    if (options.path) {
      rows = db.query(`
        SELECT s.*, f.language FROM code_index_symbols s
        JOIN code_index_files f ON f.path = s.path
        WHERE s.path = ? ORDER BY s.line LIMIT ?
      `).all(path.resolve(options.path), limit) as Array<Record<string, unknown>>;
    } else {
      const needle = (options.query ?? "").trim().toLowerCase();
      rows = db.query(`
        SELECT s.*, f.language FROM code_index_symbols s
        JOIN code_index_files f ON f.path = s.path
        WHERE s.name_lower LIKE ? ORDER BY s.name_lower, s.line LIMIT ?
      `).all(`%${needle}%`, limit) as Array<Record<string, unknown>>;
    }
    return rows.map(mapSymbolRow);
  } finally {
    db.close();
  }
}

function mapSymbolRow(row: Record<string, unknown>): CodeSymbolHit {
  return {
    name: String(row.name ?? ""),
    kind: String(row.kind ?? "variable") as CodeSymbol["kind"],
    line: Number(row.line ?? 0),
    column: Number(row.column ?? 0),
    path: String(row.path ?? ""),
    relPath: String(row.rel_path ?? ""),
    language: String(row.language ?? ""),
    ...(typeof row.container === "string" ? { container: row.container } : {}),
    ...(typeof row.signature === "string" ? { signature: row.signature } : {}),
  };
}

export function findDefinition(name: string, dbPath = codeIndexDbPath()): CodeSymbolHit[] {
  const normalized = name.trim();
  if (!normalized) return [];
  const db = openCodeIndexDb(dbPath);
  try {
    const exact = normalized.toLowerCase();
    const rows = db.query(`
      SELECT s.*, f.language FROM code_index_symbols s
      JOIN code_index_files f ON f.path = s.path
      WHERE s.name_lower = ? ORDER BY s.line LIMIT 20
    `).all(exact) as Array<Record<string, unknown>>;
    if (rows.length > 0) return rows.map(mapSymbolRow);
    return (db.query(`
      SELECT s.*, f.language FROM code_index_symbols s
      JOIN code_index_files f ON f.path = s.path
      WHERE s.name_lower LIKE ? ORDER BY s.name_lower, s.line LIMIT 20
    `).all(`%${exact}%`) as Array<Record<string, unknown>>).map(mapSymbolRow);
  } finally {
    db.close();
  }
}

export interface CodeReferenceHit {
  path: string;
  relPath: string;
  line: number;
  column: number;
  preview: string;
  isDefinition: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findReferences(name: string, limit = 50, dbPath = codeIndexDbPath()): CodeReferenceHit[] {
  const normalized = name.trim();
  if (!normalized) return [];
  const db = openCodeIndexDb(dbPath);
  try {
    const definition = db.query("SELECT path, line, column FROM code_index_symbols WHERE name_lower = ? LIMIT 1")
      .get(normalized.toLowerCase()) as { path?: string; line?: number; column?: number } | null;
    const match = ftsTerms(normalized);
    const candidates = match
      ? db.query(`
          SELECT f.path, f.rel_path, f.content FROM code_index_fts
          JOIN code_index_files f ON f.path = code_index_fts.path
          WHERE code_index_fts MATCH ? LIMIT 500
        `).all(match) as Array<Record<string, unknown>>
      : [];
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_$])${escapeRegExp(normalized)}($|[^\\p{L}\\p{N}_$])`, "gu");
    const hits: CodeReferenceHit[] = [];
    for (const row of candidates) {
      const content = String(row.content ?? "");
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        pattern.lastIndex = 0;
        const found = pattern.exec(line);
        if (!found) continue;
        const column = (found.index ?? 0) + (found[1]?.length ?? 0) + 1;
        const isDefinition = String(row.path) === definition?.path && index + 1 === definition?.line;
        hits.push({
          path: String(row.path),
          relPath: String(row.rel_path ?? ""),
          line: index + 1,
          column,
          preview: line.trim().slice(0, 240),
          isDefinition,
        });
        if (hits.length >= limit) return hits;
        continue;
      }
    }
    return hits;
  } finally {
    db.close();
  }
}

export interface CodeDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  message: string;
  code: string;
}

export function syntaxDiagnostics(filePath: string): CodeDiagnostic[] {
  const absolute = path.resolve(filePath);
  if (!isTypeScriptFile(absolute)) return [];
  const content = fs.readFileSync(absolute, "utf8");
  const result = ts.transpileModule(content, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      allowJs: true,
    },
    fileName: absolute,
    reportDiagnostics: true,
  });
  return (result.diagnostics ?? []).map((diagnostic) => {
    const at = diagnostic.file && typeof diagnostic.start === "number"
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : { line: 0, character: 0 };
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    return {
      file: absolute,
      line: at.line + 1,
      column: at.character + 1,
      severity: diagnostic.category === ts.DiagnosticCategory.Error ? "error" : diagnostic.category === ts.DiagnosticCategory.Warning ? "warning" : "info",
      message,
      code: String(diagnostic.code),
    };
  });
}

/** 是否是代码文件（工具层用它给“不支持”的明确理由）。 */
export function supportsSymbols(filePath: string): boolean {
  return isCodeFile(filePath);
}
