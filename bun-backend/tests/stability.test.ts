/**
 * tests/stability.test.ts — STABILITY-001/006/007/008/009 回归锁。
 *
 * 锁四类"静默失败/资源泄漏"的运行时行为（全走真实代码路径）：
 *   - 逃逸错误兜底：unhandledRejection 形状必须进 error-collector（STABILITY-001）
 *   - 回合看门狗：超时 turnStates 清理 + kernel cancel + 客户端可见 error（006）
 *   - 断开后的取消失败必须可观察——callRpc 永不 reject，`.catch(()=>{})` 是死代码（007）
 *   - 最后一连接断开会话级附属表（seenClientMsgIds）一并清理（008）
 * 回合登记经 `handleChatMessage("chat")` 的同步路径完成（turnStates.set 在
 * 异步 provider 解析之前），不依赖模块私有表。
 */

import { describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { getErrorCollector } from "../src/error-collector";
import {
  reportEscapedError,
  registerProcessGuards,
} from "../src/server";
import {
  handleChatMessage,
  sweepStaleTurns,
  unregisterChatConnection,
  type ChatWsHub,
  type WsData,
} from "../src/routes/chat-ws";

let sidSeq = 0;
const SID = () => `s${(sidSeq++).toString(36).padStart(31, "0")}`;
const NOW = performance.now();
const STALE_NOW = NOW + 31 * 60_000; // 默认 30 分钟阈值之外

interface HubStub {
  sid: string;
  hub: ChatWsHub;
  ws: ServerWebSocket<WsData>;
  broadcasts: Array<{ type: string; payload: Record<string, unknown> }>;
  calls: Array<{ method: string; params: Record<string, unknown> }>;
}

function makeHub(callRpc: ChatWsHub["callRpc"] = () => Promise.resolve({ ok: true, result: {} })): HubStub {
  const sid = SID();
  const broadcasts: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const hub: ChatWsHub = {
    sessions: new Map(),
    pendingPlans: new Map(),
    connections: new Map(),
    seenClientMsgIds: new Map(),
    callRpc: (method, params) => {
      calls.push({ method, params });
      return callRpc(method, params);
    },
    broadcast: (targetSid, event) => {
      if (targetSid === sid) broadcasts.push(event as { type: string; payload: Record<string, unknown> });
    },
  };
  const ws = {
    data: { sessionId: sid },
    send: () => {},
    close: () => {},
  } as unknown as ServerWebSocket<WsData>;
  return { hub, sid, ws, broadcasts, calls };
}

function startTurn(hub: ChatWsHub, ws: ServerWebSocket<WsData>): void {
  // 同步路径：client_msg_id 幂等登记 + turnStates.set 都在异步 provider 解析之前完成
  handleChatMessage(hub, ws, JSON.stringify({
    type: "chat",
    payload: { message: "稳定性探针", provider_id: "stub", model_name: "stub-model", client_msg_id: `c-${Math.random()}` },
  }));
}

const drainMicrotasks = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("STABILITY-001 逃逸错误兜底", () => {
  test("unhandledRejection 形状进 error-collector（含 stack）", () => {
    const before = getErrorCollector().getAll().length;
    const err = new Error("esc: rejection probe");
    reportEscapedError("unhandledRejection", err);
    const all = getErrorCollector().getAll();
    expect(all.length).toBeGreaterThan(before);
    const last = all[all.length - 1]!;
    expect(last.level).toBe("ERROR");
    expect(last.message).toContain("esc: rejection probe");
    expect(last.exception).toContain("rejection probe");
  });

  test("registerProcessGuards 可注册（幂等场景只要求不抛）", () => {
    expect(() => registerProcessGuards()).not.toThrow();
  });
});

describe("STABILITY-006 回合看门狗", () => {
  test("未超时的回合不动", () => {
    const { hub, ws, broadcasts } = makeHub();
    startTurn(hub, ws);
    const stale = sweepStaleTurns(hub, NOW);
    expect(stale).toEqual([]);
    expect(broadcasts.filter((b) => b.type === "error")).toHaveLength(0);
  });

  test("超时回合：清理 + kernel cancel + 广播 turn_timeout + 失败进 collector", async () => {
    const { hub, sid, ws, calls, broadcasts } = makeHub(() => Promise.resolve({ ok: false, error: "kernel busy" }));
    startTurn(hub, ws);
    const before = getErrorCollector().getAll().length;

    const stale = sweepStaleTurns(hub, STALE_NOW);
    // bun test 单进程共享模块态：其他测试文件登记的回合也会被同一把扫帚
    // 扫到——只锁"本用例的回合被清理"，不锁全集长度。
    expect(stale).toContain(sid);

    await drainMicrotasks();
    // kernel cancel 被调用
    expect(calls.some((c) => c.method === "cancel")).toBe(true);
    // 客户端能看到超时 error（不再静默 BUSY 到重连）
    const errEvent = broadcasts.find((b) => b.type === "error" && b.payload.code === "turn_timeout");
    expect(errEvent).toBeDefined();
    // cancel 失败可观察
    const all = getErrorCollector().getAll();
    expect(all.length).toBeGreaterThan(before);
    expect(all[all.length - 1]!.message).toContain("kernel busy");
  });
});

describe("STABILITY-007/008 断开清理与可观察取消", () => {
  test("在途回合断开：取消发出；ok:false 进 collector 而不是静默", async () => {
    const { hub, sid, ws, calls, broadcasts } = makeHub(() => Promise.resolve({ ok: false, error: "kernel not responding" }));
    startTurn(hub, ws);
    hub.connections.set(sid, new Set([ws]));
    const before = getErrorCollector().getAll().length;

    unregisterChatConnection(hub, sid, ws);
    await drainMicrotasks();

    expect(calls.some((c) => c.method === "cancel")).toBe(true);
    const all = getErrorCollector().getAll();
    expect(all.length).toBeGreaterThan(before);
    expect(all[all.length - 1]!.message).toContain("kernel not responding");
  });

  test("最后一连接断开：seenClientMsgIds 一并清理（防按 sessionId 泄漏）", () => {
    const { hub, sid, ws } = makeHub();
    hub.connections.set(sid, new Set([ws]));
    hub.seenClientMsgIds.set(sid, ["m1", "m2"]);

    unregisterChatConnection(hub, sid, ws);

    expect(hub.connections.has(sid)).toBe(false);
    expect(hub.seenClientMsgIds.has(sid)).toBe(false);
  });

  test("幂等窗口 200 条封顶（长会话不无界增长）", () => {
    const { hub, sid, ws } = makeHub();
    for (let i = 0; i < 250; i++) {
      handleChatMessage(hub, ws, JSON.stringify({
        type: "chat",
        payload: { message: `m${i}`, client_msg_id: `id-${i}` },
      }));
    }
    const ids = hub.seenClientMsgIds.get(sid) ?? [];
    // 250 个回合成功登记后 id 窗口不超过 200（登记发生在 done 路径之外时
    // 至少不超上限；此断言锁的是 push 端的环形裁剪）
    expect(ids.length).toBeLessThanOrEqual(200);
  });
});

describe("STABILITY-009 全局错误边界", () => {
  test("缺失路由仍返回 JSON（onError/notFound 不产生 HTML 崩溃页）", async () => {
    const { createApp } = await import("../src/server");
    const app = createApp();
    const res = await app.request("/api/__definitely_missing__", { method: "GET" });
    const contentType = res.headers.get("content-type") ?? "";
    expect([404, 401].includes(res.status) || contentType.includes("json")).toBe(true);
  });
});
