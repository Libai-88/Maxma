/**
 * const-session-store.ts — Const 固定会话 YAML 存储（api/const_session_store.py
 * 的 Bun 直译，阶段二 2.2h）。
 *
 * 数据：API_DATA_DIR/const-sessions/{session_id}.yaml（metadata + messages）。
 * CONST-DELETE-001：删除与保存共用同一互斥语义（Bun 单线程同步 I/O 天然满足）。
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { getApiDataDir } from "./app-paths";
import { BunYamlSafeParse, writeYamlAtomic } from "./yaml-store";

function constSessionsDir(): string {
  return path.join(getApiDataDir(), "const-sessions");
}

function ensureDir(): string {
  const dir = constSessionsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveConstSession(
  sessionId: string,
  constName: string,
  metadata: Record<string, unknown>,
  messages: Array<Record<string, unknown>>,
): string {
  const dir = ensureDir();
  const data = {
    session_id: sessionId,
    const_name: constName,
    const_saved_at: Date.now() / 1000,
    metadata,
    messages,
  };
  const filepath = path.join(dir, `${sessionId}.yaml`);
  writeYamlAtomic(filepath, data);
  return filepath;
}

export function loadConstSession(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const data = BunYamlSafeParse(fs.readFileSync(filePath, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch (err) {
    console.warn(`[const] failed to load session file ${filePath}: ${String(err)}`);
    return null;
  }
}

export function loadConstSessionById(sessionId: string): Record<string, unknown> | null {
  return loadConstSession(path.join(constSessionsDir(), `${sessionId}.yaml`));
}

export function loadAllConstSessions(): Array<Record<string, unknown>> {
  const dir = ensureDir();
  const sessions: Array<Record<string, unknown>> = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()) {
    const data = loadConstSession(path.join(dir, f));
    if (data && data.session_id) sessions.push(data);
  }
  return sessions;
}

export function deleteConstSession(sessionId: string): boolean {
  const filepath = path.join(constSessionsDir(), `${sessionId}.yaml`);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
    return true;
  }
  return false;
}
