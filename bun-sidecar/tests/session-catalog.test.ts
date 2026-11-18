/**
 * tests/session-catalog.test.ts — 磁盘历史会话的发现（kernel/session-catalog.ts）。
 *
 * 为什么补这份用例：`session-catalog.ts` 一直挂在覆盖率的 DEBT 名单里（下限 11%），
 * 但它同时是「重启后会话列表从哪来」的唯一来源。本轮给它加了 `name` 回读
 * （pi 把会话名存成一条 `session_info` 条目），只多一行就有 11% → 10.71% 的倒退；
 * 靠调低下限掩盖不值得，直接把这条路径测起来。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  deletePersistedSession,
  findPersistedSession,
  listPersistedSessions,
  normalizeSessionId,
  sessionDir,
} from "../src/kernel/session-catalog";

let root = "";
const prevPiDir = process.env.PI_CODING_AGENT_DIR;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-catalog-"));
  process.env.PI_CODING_AGENT_DIR = path.join(root, "pi");
});

afterEach(() => {
  if (prevPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = prevPiDir;
  fs.rmSync(root, { recursive: true, force: true });
});

const SID = "0123456789abcdef0123456789abcdef";

type WriteOpts = { id?: string; preview?: string; name?: string; contentType?: "string" | "array" };

/** 写一个 pi 会话文件：header + 一条用户消息 + 一条助手消息（+ 可选的 session_info）。 */
function writeSession(opts: WriteOpts = {}): string {
  const id = opts.id ?? SID;
  const dir = sessionDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `2026-11-18T10-00-00-000Z_${id}.jsonl`);
  const content = opts.contentType === "array"
    ? [{ type: "text", text: opts.preview ?? "数组形式的问题" }]
    : (opts.preview ?? "重启前的问题");
  const lines = [
    JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-11-18T10:00:00.000Z", cwd: root }),
    JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-11-18T10:00:01.000Z", message: { role: "user", content } }),
    JSON.stringify({ type: "message", id: "m2", parentId: "m1", timestamp: "2026-11-18T10:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "好的" }] } }),
  ];
  if (opts.name !== undefined) {
    lines.push(JSON.stringify({ type: "session_info", id: "m3", parentId: "m2", timestamp: "2026-11-18T10:00:03.000Z", name: opts.name }));
  }
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

describe("session-catalog（磁盘发现）", () => {
  test("列出会话：id 归一化、消息数、预览（字符串与数组两种 content）", () => {
    writeSession({ preview: "重启前的问题" });
    writeSession({ id: "fedcba9876543210fedcba9876543210", preview: "数组形式的问题", contentType: "array" });

    const list = listPersistedSessions(50, root);
    expect(list).toHaveLength(2);
    const byId = new Map(list.map((s) => [s.session_id, s]));
    expect(byId.get(SID)?.message_count).toBe(2);
    expect(byId.get(SID)?.preview).toBe("重启前的问题");
    expect(byId.get("fedcba9876543210fedcba9876543210")?.preview).toBe("数组形式的问题");
  });

  test("会话名从 session_info 回读；没名字时为空串", () => {
    writeSession({ name: "排版与空态的收口" });
    writeSession({ id: "fedcba9876543210fedcba9876543210" });

    const list = listPersistedSessions(50, root);
    const byId = new Map(list.map((s) => [s.session_id, s]));
    // 名字不在 header 里，而在一条 session_info 条目里：漏读它，重命名过的会话
    // 一重启就退回「会话 <id 前 8 位>」。
    expect(byId.get(SID)?.name).toBe("排版与空态的收口");
    expect(byId.get("fedcba9876543210fedcba9876543210")?.name).toBe("");
  });

  test("find / delete 只碰目标文件；损坏文件不影响列表", () => {
    const file = writeSession({ name: "待删的会话" });
    fs.writeFileSync(path.join(sessionDir(root), "broken.jsonl"), '{"type":"session","vers');

    expect(listPersistedSessions(50, root).map((s) => s.session_id)).toEqual([SID]);
    expect(findPersistedSession(SID, root)?.name).toBe("待删的会话");
    // 带连字符的 uuid 用同一份归一化规则匹配。
    expect(findPersistedSession("01234567-89ab-cdef-0123-456789abcdef", root)?.session_id).toBe(SID);

    expect(deletePersistedSession(SID, root)).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    expect(deletePersistedSession(SID, root)).toBe(false);
    expect(findPersistedSession(SID, root)).toBeNull();
  });

  test("normalizeSessionId：只接受 32 位 hex 或其无损 uuid", () => {
    expect(normalizeSessionId(SID)).toBe(SID);
    expect(normalizeSessionId("01234567-89AB-CDEF-0123-456789ABCDEF")).toBe(SID);
    expect(normalizeSessionId("not-hex")).toBeNull();
    expect(normalizeSessionId(undefined)).toBeNull();
  });
});
