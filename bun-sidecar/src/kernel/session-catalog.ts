/**
 * kernel/session-catalog.ts — 磁盘上历史会话的发现与恢复（P1 修复）。
 *
 * 背景：pi 的会话载体是 `SessionManager`（JSONL 树）。进程重启后 hub 里的
 * 会话表为空，而 `GET /api/sessions` 只遍历内存表 —— 结果磁盘文件还在，
 * 界面却看不到、也打不开。这里补齐"列出"和"解析成可恢复路径"两件事，
 * 全部走 pi 官方 API：
 *   - `SessionManager.create(cwd).getSessionDir()` 取官方 session 目录
 *     （不自己拼 `sessions/<slug>`：编码规则属于引擎）。
 *   - `SessionManager.open(file)` 读 header/entries（不落盘、不改文件）。
 *
 * 会话 id 归一化：pi header 里的 id 是带连字符的 uuid，而 Maxma 的 WS/前端
 * 约定是 32 位小写 hex（`useChat.ts` 有校验）。两边统一用归一化后的 id。
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import { maxmaProjectRoot } from "./project-paths";

export interface PersistedSessionInfo {
  session_id: string;
  /** 绝对路径（仅 backend 内部用于 resume，不外泄到 REST 响应）。 */
  file: string;
  message_count: number;
  created_at: string;
  updated_at: string;
  /** 最后一条用户消息的纯文本摘要（≤60 字），用于会话列表。 */
  preview: string;
  cwd: string;
}

/** 32 位 hex，或可无损转成 32 位 hex 的 uuid（含连字符/大写）。 */
export function normalizeSessionId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const compact = raw.replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(compact) ? compact : null;
}

/** 官方 session 目录（由 pi 的 cwd→目录编码规则决定，不在 Maxma 复刻）。 */
export function sessionDir(cwd: string = maxmaProjectRoot()): string {
  return SessionManager.create(cwd).getSessionDir();
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
      ? (part as { text: string }).text
      : ""))
    .join("");
}

function previewOf(entries: Array<{ type?: string; message?: { role?: string; content?: unknown } }>): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.type !== "message") continue;
    const role = entry.message?.role;
    if (role !== "user" && role !== "human") continue;
    const text = textOf(entry.message?.content).replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 60);
  }
  return "";
}

function readOne(file: string): PersistedSessionInfo | null {
  try {
    const manager = SessionManager.open(file);
    const header = manager.getHeader();
    const sessionId = normalizeSessionId(header?.id);
    if (!header || !sessionId) return null;
    const entries = manager.getEntries() as Array<{ type?: string; message?: { role?: string; content?: unknown } }>;
    const stat = fs.statSync(file);
    return {
      session_id: sessionId,
      file,
      message_count: entries.filter((entry) => entry.type === "message").length,
      created_at: header.timestamp,
      updated_at: new Date(stat.mtimeMs).toISOString(),
      preview: previewOf(entries),
      cwd: header.cwd,
    };
  } catch {
    // 损坏/半截文件（崩溃写入）不阻断列表：跳过并在 UI 上自然消失。
    return null;
  }
}

/** 列出历史会话，按文件修改时间倒序。损坏文件静默跳过。 */
export function listPersistedSessions(limit = 50, cwd: string = maxmaProjectRoot()): PersistedSessionInfo[] {
  const dir = sessionDir(cwd);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const stamped = names
    .map((name) => {
      const file = path.join(dir, name);
      try {
        return { file, mtime: fs.statSync(file).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((item): item is { file: string; mtime: number } => item !== null)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit);

  const sessions: PersistedSessionInfo[] = [];
  for (const item of stamped) {
    const info = readOne(item.file);
    if (info) sessions.push(info);
  }
  return sessions;
}

/** 删除历史会话文件（仅磁盘，不碰内存会话）。返回是否删除。 */
export function deletePersistedSession(sessionId: string, cwd: string = maxmaProjectRoot()): boolean {
  const found = findPersistedSession(sessionId, cwd);
  if (!found) return false;
  try {
    fs.unlinkSync(found.file);
    return true;
  } catch {
    return false;
  }
}

/** 按归一化 id 找历史会话文件；找不到返回 null。 */
export function findPersistedSession(sessionId: string, cwd: string = maxmaProjectRoot()): PersistedSessionInfo | null {
  const wanted = normalizeSessionId(sessionId);
  if (!wanted) return null;
  const dir = sessionDir(cwd);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return null;
  }
  for (const name of names) {
    const info = readOne(path.join(dir, name));
    if (info?.session_id === wanted) return info;
  }
  return null;
}