/**
 * tests/entry-smoke.test.ts — 入口装配层冒烟（SMOKE-ENTRY-001）。
 *
 * 背景：kernel 单测直调 handlePiCreateSession 传 fake io，不经过
 * session-bridge.ts 的 bridgeDeps() 装配层——该层漏 import sendEvent 的
 * ReferenceError 在编译产物真机冒烟才暴露。本测试拦截 stdout，
 * 经真实 handleRpcRequest 全链路覆盖入口装配（含会话销毁）。
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { handleRpcRequest } from "../src/session-bridge";

/** 拦截 stdout 收集 JSON-RPC 输出行（入口唯一的输出通道）。 */
function captureStdout(): { lines: () => string[]; restore: () => void } {
  const buffer: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    buffer.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  return {
    lines: () => buffer.join("").split("\n").filter((l) => l.trim()),
    restore: () => {
      process.stdout.write = orig;
    },
  };
}

describe("entry smoke: handleRpcRequest 装配层", () => {
  test("create_session → 真实 session_id 返回；未知会话 RPC → Session not found", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-entry-"));
    const prevRoot = process.env.MAXMA_PROJECT_ROOT;
    process.env.MAXMA_PROJECT_ROOT = dir;
    const cap = captureStdout();
    try {
      await handleRpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "create_session",
        params: { cwd: import.meta.dir, in_memory: true, permission_mode: "auto" },
      } as never);
      const lines = cap.lines();
      const created = lines.find((l) => l.includes('"id":1'));
      expect(created).toBeDefined();
      expect(created).toContain("session_id");

      const sid = (JSON.parse(created!) as { result: { session_id: string } }).result.session_id;

      // 命中会话表：get_health 正常返回
      await handleRpcRequest({ jsonrpc: "2.0", id: 2, method: "get_health", params: { session_id: sid } } as never);
      expect(cap.lines().join("")).toContain('"engine":"pi"');

      // destroy 清理后：同会话再操作 → Session not found（装配层错误路径）
      await handleRpcRequest({ jsonrpc: "2.0", id: 3, method: "destroy_session", params: { session_id: sid } } as never);
      await handleRpcRequest({ jsonrpc: "2.0", id: 4, method: "get_health", params: { session_id: sid } } as never);
      expect(cap.lines().join("")).toContain("Session not found");

      // 未知方法 → Unknown method
      await handleRpcRequest({ jsonrpc: "2.0", id: 5, method: "no_such_method", params: {} } as never);
      expect(cap.lines().join("")).toContain("Unknown method");
    } finally {
      cap.restore();
      if (prevRoot === undefined) delete process.env.MAXMA_PROJECT_ROOT;
      else process.env.MAXMA_PROJECT_ROOT = prevRoot;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
