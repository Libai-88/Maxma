/**
 * services/workspace-store.ts — 工作区根授权清单（Workbench 2.0 P0）。
 *
 * 这里存的是"用户允许文件面板展示/读取哪些目录"，不是 Agent 的全局路径白名单。
 * 清单落在 <data>/api/data/workspaces.json，写入使用 temp + rename，避免读到半截 JSON。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

import { getApiDataDir } from "../app-paths";

export interface WorkspaceRoot {
  id: string;
  label: string;
  path: string;
  realpath: string;
  created_at: number;
  last_used_at: number;
}

interface WorkspaceStoreFile {
  version: 1;
  roots: WorkspaceRoot[];
}

const EMPTY_STORE: WorkspaceStoreFile = { version: 1, roots: [] };

export function workspaceStorePath(): string {
  return path.join(getApiDataDir(), "workspaces.json");
}

function isRoot(value: unknown): value is WorkspaceRoot {
  if (!value || typeof value !== "object") return false;
  const root = value as Partial<WorkspaceRoot>;
  return typeof root.id === "string" && root.id.length > 0 && root.id.length <= 80
    && typeof root.label === "string" && root.label.length > 0 && root.label.length <= 240
    && typeof root.path === "string" && root.path.length > 0
    && typeof root.realpath === "string" && root.realpath.length > 0
    && typeof root.created_at === "number" && Number.isFinite(root.created_at)
    && typeof root.last_used_at === "number" && Number.isFinite(root.last_used_at);
}

function readStore(): WorkspaceStoreFile {
  try {
    const raw = fs.readFileSync(workspaceStorePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...EMPTY_STORE, roots: [] };
    const roots = (parsed as { roots?: unknown }).roots;
    if (!Array.isArray(roots)) return { ...EMPTY_STORE, roots: [] };
    return { version: 1, roots: roots.filter(isRoot).slice(0, 64) };
  } catch {
    return { ...EMPTY_STORE, roots: [] };
  }
}

function writeStore(store: WorkspaceStoreFile): void {
  const target = workspaceStorePath();
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

export function listWorkspaceRoots(): WorkspaceRoot[] {
  return readStore().roots;
}

export function getWorkspaceRoot(id: string): WorkspaceRoot | null {
  return readStore().roots.find((root) => root.id === id) ?? null;
}

export function addWorkspaceRoot(inputPath: string, label?: string): WorkspaceRoot {
  if (!inputPath || inputPath.includes("\x00")) throw new Error("无效路径");
  const absolute = path.resolve(inputPath);
  let realpath: string;
  try {
    const stat = fs.statSync(absolute);
    if (!stat.isDirectory()) throw new Error("路径不是文件夹");
    realpath = fs.realpathSync.native(absolute);
  } catch (error) {
    if (error instanceof Error && error.message === "路径不是文件夹") throw error;
    throw new Error("文件夹不存在或不可访问");
  }

  const store = readStore();
  const existing = store.roots.find((root) => root.realpath === realpath);
  if (existing) {
    existing.last_used_at = Date.now();
    writeStore(store);
    return existing;
  }

  if (store.roots.length >= 64) throw new Error("工作区数量已达上限");
  const now = Date.now();
  const root: WorkspaceRoot = {
    id: `wr_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    label: (label?.trim() || path.basename(realpath) || realpath).slice(0, 240),
    path: absolute,
    realpath,
    created_at: now,
    last_used_at: now,
  };
  store.roots.push(root);
  writeStore(store);
  return root;
}

export function removeWorkspaceRoot(id: string): WorkspaceRoot | null {
  const store = readStore();
  const index = store.roots.findIndex((root) => root.id === id);
  if (index < 0) return null;
  const [removed] = store.roots.splice(index, 1);
  writeStore(store);
  return removed ?? null;
}

export function renameWorkspaceRoot(id: string, label: string): WorkspaceRoot | null {
  const normalized = label.trim();
  if (!normalized || normalized.length > 240) throw new Error("标签必须为 1–240 个字符");
  const store = readStore();
  const root = store.roots.find((candidate) => candidate.id === id);
  if (!root) return null;
  root.label = normalized;
  writeStore(store);
  return root;
}

export function touchWorkspaceRoot(id: string): void {
  const store = readStore();
  const root = store.roots.find((candidate) => candidate.id === id);
  if (!root) return;
  const now = Date.now();
  // 一次目录浏览会触发多次请求；一分钟内不重复写盘。
  if (now - root.last_used_at < 60_000) return;
  root.last_used_at = now;
  writeStore(store);
}
