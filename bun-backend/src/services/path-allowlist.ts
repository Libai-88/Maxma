/**
 * services/path-allowlist.ts — 用户显式追加的 Agent 文件访问根（M1 / T2）。
 *
 * 与 workspaces.json 的区别：
 *   - workspaces.json 是“文件面板展示/编辑哪些目录”；
 *   - path-allowlist.json 是“Agent 文件工具还允许访问哪些额外根”。
 * 两者都是用户显式授权，不是自动发现；所有条目落盘前必须 realpath 成目录。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

import { getApiDataDir } from "../app-paths";

export interface PathAllowlistEntry {
  id: string;
  path: string;
  realpath: string;
  added_at: number;
  last_used_at: number;
}

interface PathAllowlistFile {
  version: 1;
  entries: PathAllowlistEntry[];
}

const EMPTY: PathAllowlistFile = { version: 1, entries: [] };
const MAX_ENTRIES = 32;

export function pathAllowlistPath(): string {
  return path.join(getApiDataDir(), "path-allowlist.json");
}

function readStore(): PathAllowlistFile {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(pathAllowlistPath(), "utf8"));
    if (!parsed || typeof parsed !== "object") return { ...EMPTY, entries: [] };
    const entries = (parsed as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) return { ...EMPTY, entries: [] };
    return {
      version: 1,
      entries: entries
        .filter((item): item is PathAllowlistEntry => {
          if (!item || typeof item !== "object") return false;
          const entry = item as Partial<PathAllowlistEntry>;
          return typeof entry.id === "string"
            && typeof entry.path === "string"
            && typeof entry.realpath === "string"
            && typeof entry.added_at === "number"
            && typeof entry.last_used_at === "number";
        })
        .slice(0, MAX_ENTRIES),
    };
  } catch {
    return { ...EMPTY, entries: [] };
  }
}

function writeStore(store: PathAllowlistFile): void {
  const target = pathAllowlistPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  try {
    fs.writeFileSync(temp, JSON.stringify(store, null, 2), "utf8");
    fs.renameSync(temp, target);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch { /* best effort */ }
    throw error;
  }
}

export function listPathAllowlist(): PathAllowlistEntry[] {
  return readStore().entries;
}

export function addPathAllowlistEntry(inputPath: string): PathAllowlistEntry {
  if (typeof inputPath !== "string" || !inputPath.trim() || inputPath.includes("\x00")) {
    throw new Error("路径不能为空");
  }
  const lexical = path.resolve(inputPath.trim());
  let realpath: string;
  try {
    const stat = fs.statSync(lexical);
    if (!stat.isDirectory()) throw new Error("路径不是文件夹");
    realpath = fs.realpathSync.native(lexical);
  } catch (error) {
    if (error instanceof Error && error.message === "路径不是文件夹") throw error;
    throw new Error("文件夹不存在或不可访问");
  }

  const store = readStore();
  const existing = store.entries.find((entry) => entry.realpath === realpath);
  if (existing) {
    existing.last_used_at = Date.now();
    writeStore(store);
    return existing;
  }
  if (store.entries.length >= MAX_ENTRIES) throw new Error(`路径 allowlist 最多 ${MAX_ENTRIES} 条`);
  const now = Date.now();
  const entry: PathAllowlistEntry = {
    id: `pa_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    path: lexical,
    realpath,
    added_at: now,
    last_used_at: now,
  };
  store.entries.push(entry);
  writeStore(store);
  return entry;
}

export function removePathAllowlistEntry(id: string): PathAllowlistEntry | null {
  const store = readStore();
  const index = store.entries.findIndex((entry) => entry.id === id);
  if (index < 0) return null;
  const [removed] = store.entries.splice(index, 1);
  writeStore(store);
  return removed ?? null;
}
