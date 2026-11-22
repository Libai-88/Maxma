/**
 * docintel/index.ts — 文档索引的构建、取消、状态与增量更新。
 *
 * 口径：
 *   - 索引是派生物，独立库；构建后台运行，HTTP 只启动/查询/取消；
 *   - 文件指纹 mtime+size 快速跳过，sha256 处理“同 mtime 同 size 内容变了”；
 *   - 完整扫描结束才删除陈旧文件；取消或触顶时保留未扫到的旧索引；
 *   - 单项目 20k 文件、单文件 20MB 硬上限；不支持/扫描件显式标记，不伪造文本。
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Database } from "bun:sqlite";

import {
  deleteFile,
  docIndexDbPath,
  getFileMeta,
  knownPathsForRoot,
  openDocIndexDb,
  readRootRow,
  rootStats,
  upsertFile,
  writeRootRow,
  type DocFileRow,
  type DocIndexRootRow,
} from "./store";
import { extractDocument, isSupportedDoc } from "./extract";

const IGNORED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "target",
  ".idea",
  ".vscode",
  ".cache",
  ".turbo",
  ".parcel-cache",
  ".yarn",
  ".pnpm-store",
  ".maxma",
  "vendor",
  "Pods",
  ".gradle",
  ".terraform",
]);

const MAX_DOC_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES_PER_RUN = 20_000;

interface ActiveJob {
  cancelled: boolean;
  progress: number;
  fileCount: number;
  startedAt: number;
}

const activeJobs = new Map<string, ActiveJob>();

export interface DocIndexOptions {
  label?: string;
  force?: boolean;
  maxFiles?: number;
}

export interface DocIndexStatus extends DocIndexRootRow {
  running: boolean;
  startedAt: number | null;
}

function normalizeRoot(root: string): string {
  return fs.realpathSync.native(path.resolve(root));
}

function rootStatus(db: Database, root: string, label: string): DocIndexStatus {
  const row = readRootRow(db, root) ?? {
    root,
    label,
    indexedAt: null,
    status: "idle" as const,
    fileCount: 0,
    chunkCount: 0,
    unsupportedCount: 0,
    error: null,
    warnings: [],
    progress: 0,
  };
  const job = activeJobs.get(root);
  return { ...row, running: Boolean(job), startedAt: job?.startedAt ?? null };
}

export function getDocIndexStatus(dbPath?: string, roots?: Array<{ path: string; label?: string }>): DocIndexStatus[] {
  const db = openDocIndexDb(dbPath);
  try {
    return (roots ?? []).map((item) => {
      try {
        return rootStatus(db, normalizeRoot(item.path), item.label ?? "");
      } catch {
        return {
          root: path.resolve(item.path),
          label: item.label ?? "",
          indexedAt: null,
          status: "error" as const,
          fileCount: 0,
          chunkCount: 0,
          unsupportedCount: 0,
          error: "工作区根不存在或不可访问",
          warnings: [],
          progress: 0,
          running: false,
          startedAt: null,
        };
      }
    });
  } finally {
    db.close();
  }
}

export function startDocIndex(root: string, options: DocIndexOptions = {}, dbPath = docIndexDbPath()): DocIndexStatus {
  const realRoot = normalizeRoot(root);
  const db = openDocIndexDb(dbPath);
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
      chunkCount: previous?.chunkCount ?? 0,
      unsupportedCount: previous?.unsupportedCount ?? 0,
      error: null,
      warnings: [],
      progress: 0,
    });
    const status = rootStatus(db, realRoot, options.label ?? "");
    void runIndex(realRoot, options, dbPath, job);
    return status;
  } finally {
    db.close();
  }
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
      } else if (entry.isFile() && isSupportedDoc(entry.name)) {
        files.push(absolute);
      }
    }
  };
  await walk(root);
  return files;
}

async function runIndex(root: string, options: DocIndexOptions, dbPath: string, job: ActiveJob): Promise<void> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  try {
    const limit = Math.min(options.maxFiles ?? MAX_FILES_PER_RUN, MAX_FILES_PER_RUN);
    const files = await collectFiles(root, limit, job);
    const completeScan = !job.cancelled && files.length < limit;
    const db = openDocIndexDb(dbPath);
    try {
      const seen = new Set<string>();
      const previous = readRootRow(db, root);
      const previousLabel = options.label ?? previous?.label ?? path.basename(root);

      for (let index = 0; index < files.length; index += 1) {
        if (job.cancelled) break;
        const absolute = files[index];
        if (!absolute) continue;
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        const stat = await fs.promises.stat(absolute).catch(() => null);
        if (!stat?.isFile()) continue;
        if (stat.size > MAX_DOC_FILE_BYTES) {
          warnings.push(`${relative}：超过 ${MAX_DOC_FILE_BYTES / 1024 / 1024}MB，已跳过`);
          continue;
        }
        const previousMeta = getFileMeta(db, absolute);
        if (!options.force && previousMeta && previousMeta.mtimeMs === stat.mtimeMs && previousMeta.size === stat.size) {
          seen.add(absolute);
          job.fileCount = seen.size;
          job.progress = files.length > 0 ? Math.min(1, seen.size / files.length) : 0;
          continue;
        }

        const bytes = await fs.promises.readFile(absolute).catch(() => null);
        if (!bytes) {
          warnings.push(`${relative}：读取失败，已跳过`);
          continue;
        }
        const hash = crypto.createHash("sha256").update(bytes).digest("hex");
        if (!options.force && previousMeta && previousMeta.sha256 === hash) {
          seen.add(absolute);
          job.fileCount = seen.size;
          job.progress = files.length > 0 ? Math.min(1, seen.size / files.length) : 0;
          continue;
        }

        let extracted: Awaited<ReturnType<typeof extractDocument>>;
        try {
          extracted = await extractDocument(absolute, new Uint8Array(bytes));
        } catch (error) {
          extracted = {
            format: path.extname(absolute).slice(1),
            blocks: [],
            unsupported: true,
            warning: `解析失败：${error instanceof Error ? error.message : String(error)}`,
          };
        }
        const indexedAt = Date.now();
        const fileRow: DocFileRow = {
          path: absolute,
          root,
          relPath: relative,
          format: extracted.format,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          sha256: hash,
          indexedAt,
          chunkCount: extracted.blocks.length,
          status: extracted.blocks.length > 0 ? "indexed" : "unsupported",
          error: extracted.blocks.length > 0 ? null : (extracted.warning ?? "没有可索引文本"),
        };
        db.transaction(() => {
          upsertFile(db, fileRow, extracted.blocks);
        })();
        seen.add(absolute);
        if (extracted.warning) warnings.push(`${relative}：${extracted.warning}`);
        job.fileCount = seen.size;
        job.progress = files.length > 0 ? Math.min(1, seen.size / files.length) : 0;
        if (index % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }

      if (completeScan) {
        for (const stale of knownPathsForRoot(db, root)) {
          if (!seen.has(stale)) deleteFile(db, stale);
        }
      }

      const stats = rootStats(db, root);
      writeRootRow(db, {
        root,
        label: previousLabel,
        indexedAt: Date.now(),
        status: job.cancelled ? "cancelled" : "ready",
        fileCount: stats.fileCount,
        chunkCount: stats.chunkCount,
        unsupportedCount: stats.unsupportedCount,
        error: null,
        warnings,
        progress: job.cancelled ? job.progress : 1,
      });
      console.info(
        `[doc-index] ${root}: ${stats.fileCount} files / ${stats.chunkCount} chunks in ${Date.now() - startedAt}ms${job.cancelled ? " (cancelled)" : ""}`,
      );
    } finally {
      db.close();
    }
  } catch (error) {
    try {
      const db = openDocIndexDb(dbPath);
      try {
        const previous = readRootRow(db, root);
        writeRootRow(db, {
          root,
          label: options.label ?? previous?.label ?? path.basename(root),
          indexedAt: previous?.indexedAt ?? null,
          status: "error",
          fileCount: previous?.fileCount ?? 0,
          chunkCount: previous?.chunkCount ?? 0,
          unsupportedCount: previous?.unsupportedCount ?? 0,
          error: error instanceof Error ? error.message : String(error),
          warnings,
          progress: job.progress,
        });
      } finally {
        db.close();
      }
    } catch {
      /* 状态写失败不能盖住真实错误 */
    }
    console.warn("[doc-index] index failed:", error);
  } finally {
    activeJobs.delete(root);
  }
}

export function cancelDocIndex(root: string): boolean {
  const realRoot = normalizeRoot(root);
  const job = activeJobs.get(realRoot);
  if (!job) return false;
  job.cancelled = true;
  return true;
}
