/**
 * tests/session-resume.test.ts — 重启后历史会话的发现/恢复/删除（P1 修复回归锁）。
 *
 * 事故：`GET /api/sessions` 只遍历进程内 hub，重启后 pi 的 JSONL 还在磁盘，
 * 界面却"空列表"，历史会话既看不见也打不开。
 *
 * 这里锁三件事，全部对着**真实磁盘文件**验证，不 mock 目录规则：
 *   1. 目录来自 pi 官方 `SessionManager.create(cwd).getSessionDir()`，fixture
 *      写进去就能被列出（自己拼路径的实现在这条会红）。
 *   2. 损坏/半截文件静默跳过，不阻断列表（崩溃写盘是真实现场）。
 *   3. REST 契约：history 不外泄 `file`、active 标记正确；resume 校验 id、
 *      未知 id 404；DELETE 能把磁盘文件删掉（未恢复到 hub 的历史会话）。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createSessionsRoutes } from "../src/routes/sessions";
import { findPersistedSession, listPersistedSessions, normalizeSessionId, sessionDir } from "../../bun-sidecar/src/kernel/session-catalog";
import type { PiBridgeIo } from "../../bun-sidecar/src/kernel/bridge-pi";

let dataDir = "";
const prev = { data: process.env.MAXMA_DATA_DIR, pi: process.env.PI_CODING_AGENT_DIR };

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-resume-"));
  process.env.MAXMA_DATA_DIR = dataDir;
  process.env.PI_CODING_AGENT_DIR = path.join(dataDir, "pi");
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
});

afterEach(() => {
  if (prev.data === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prev.data;
  if (prev.pi === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = prev.pi;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const SID = "0123456789abcdef0123456789abcdef";

function writeSession(id = SID, preview = "重启前的问题"): string {
  const dir = sessionDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `2026-11-12T10-00-00-000Z_${id}.jsonl`);
  const lines = [
    JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-11-12T10:00:00.000Z", cwd: dataDir }),
    JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-11-12T10:00:01.000Z", message: { role: "user", content: preview } }),
    JSON.stringify({ type: "message", id: "m2", parentId: "m1", timestamp: "2026-11-12T10:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "好的" }] } }),
  ];
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

function makeApp(sessions = new Map()) {
  const io: PiBridgeIo = { send: () => {}, sendError: () => {}, sendEvent: () => {} };
  return createSessionsRoutes({
    hub: { io, sessions: sessions as never, pendingPlans: new Map() },
    version: "test",
  });
}

describe("session catalog（磁盘发现）", () => {
  test("列出 fixture 会话：id 归一化、消息数、预览", () => {
    writeSession();
    const list = listPersistedSessions();
    expect(list).toHaveLength(1);
    expect(list[0]!.session_id).toBe(SID);
    expect(list[0]!.message_count).toBe(2);
    expect(list[0]!.preview).toBe("重启前的问题");
    expect(findPersistedSession(SID)?.session_id).toBe(SID);
  });

  test("uuid（带连字符）也能归一化匹配与恢复", () => {
    const dashed = "01234567-89ab-cdef-0123-456789abcdef";
    writeSession(dashed);
    expect(normalizeSessionId(dashed)).toBe(SID);
    expect(findPersistedSession(SID)?.session_id).toBe(SID);
  });

  test("损坏文件跳过，不影响其它会话", () => {
    writeSession();
    const dir = sessionDir();
    fs.writeFileSync(path.join(dir, "broken.jsonl"), '{"type":"session","vers');
    const list = listPersistedSessions();
    expect(list.map((s) => s.session_id)).toEqual([SID]);
  });
});

describe("REST：history / resume / delete", () => {
  test("history 列磁盘会话且不外泄 file 字段", async () => {
    writeSession();
    const res = await makeApp().request("/api/sessions/history");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: Array<Record<string, unknown>> };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]!.session_id).toBe(SID);
    expect(body.sessions[0]!.active).toBe(false);
    expect("file" in body.sessions[0]!).toBe(false);
  });

  test("history 的 active 跟随 hub 状态", async () => {
    writeSession();
    const sessions = new Map([[SID, {} as never]]);
    const res = await makeApp(sessions).request("/api/sessions/history");
    const body = (await res.json()) as { sessions: Array<{ active: boolean }> };
    expect(body.sessions[0]!.active).toBe(true);
  });

  test("resume 拒绝非法 id；未知历史 404", async () => {
    const app = makeApp();
    expect((await app.request("/api/sessions/not-hex/resume", { method: "POST" })).status).toBe(400);
    const missing = await app.request(`/api/sessions/${"0".repeat(32)}/resume`, { method: "POST" });
    expect(missing.status).toBe(404);
  });

  test("DELETE 删除未恢复的历史会话文件", async () => {
    const file = writeSession();
    const res = await makeApp().request(`/api/sessions/${SID}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(fs.existsSync(file)).toBe(false);
  });
});