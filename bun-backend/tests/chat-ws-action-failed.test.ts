/**
 * tests/chat-ws-action-failed.test.ts — ACTION-FAIL-001 回归锁。
 *
 * 会话级动作 RPC（update_auto_approve / user_response / plan_action /
 * set_plan_mode / checkpoint_action）此前用 `.catch(() => {})` 收尾，而
 * callKernelRpc **永不 throw**（失败解析为 {ok:false}）——两条失败路径
 * 全部不可见，乐观 UI 停在错误值上。本文件锁：失败必须广播
 * `action_failed`，成功不得广播。
 *
 * 结构对账（登记表 ↔ 发射点 ↔ 前端分支）由
 * bun-sidecar/tests/engine-boundary.test.ts 与 web/tests/wsEventSink.spec.ts 负责，
 * 这里只锁运行时行为。等待信号用广播本身 + 微任务排空，不挂真实时钟。
 */

import { describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { handleChatMessage, type ChatWsHub, type WsData } from "../src/routes/chat-ws";

const SID = "s".repeat(32);

type Broadcast = { type: string; payload: Record<string, unknown> };

/** 微任务排空：callRpcStrict 的广播链有几个 await 续体，10 轮必达。
 * 只用于"断言不发生"的场景；正向信号直接 await 广播本身。 */
const drain = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

interface HubMock {
  hub: ChatWsHub;
  ws: ServerWebSocket<WsData>;
  /** 全量广播记录（含已被 next() 消费的）。 */
  log: Broadcast[];
  /** 最老的一条未消费广播（等待真实信号，不猜时长）。 */
  next: () => Promise<Broadcast>;
}

function makeHub(callRpc: ChatWsHub["callRpc"]): HubMock {
  const log: Broadcast[] = [];
  const unread: Broadcast[] = [];
  const waiters: Array<(b: Broadcast) => void> = [];

  const deliver = (b: Broadcast) => {
    const waiter = waiters.shift();
    if (waiter) waiter(b);
    else unread.push(b);
  };

  const hub: ChatWsHub = {
    sessions: new Map(),
    pendingPlans: new Map(),
    connections: new Map(),
    seenClientMsgIds: new Map(),
    callRpc,
    broadcast: (targetSid, event) => {
      if (targetSid !== SID) return;
      deliver(event as Broadcast);
    },
  };

  // mock 的 ServerWebSocket：只用 data 与 send 两个成员（同 chat-ws-2.3 的注释）。
  const ws = {
    data: { sessionId: SID },
    send: () => {},
    close: () => {},
  } as unknown as ServerWebSocket<WsData>;

  return {
    hub,
    ws,
    log,
    next: () => {
      if (unread.length) return Promise.resolve(unread.shift()!);
      const { promise, resolve } = Promise.withResolvers<Broadcast>();
      waiters.push(resolve);
      return promise;
    },
  };
}

describe("ACTION-FAIL-001：会话级动作 RPC 失败广播 action_failed", () => {
  test("ok:false → 广播 action_failed，动作名与原因逐字透传", async () => {
    const { hub, ws, next } = makeHub(async () => ({ ok: false, error: "Session not found" }));

    handleChatMessage(hub, ws, JSON.stringify({ type: "update_auto_approve", payload: { auto_approve: true } }));
    const event = await next();

    expect(event.type).toBe("action_failed");
    expect(event.payload).toEqual({ action: "自动执行开关", message: "Session not found" });
  });

  test("ok:true → 不广播（成功路径各有回执：permission_mode_updated 等）", async () => {
    const { hub, ws, log } = makeHub(async () => ({ ok: true, result: null }));

    handleChatMessage(hub, ws, JSON.stringify({ type: "update_auto_approve", payload: { auto_approve: false } }));
    await drain();

    expect(log).toEqual([]);
  });

  test("callRpc 万一 reject（防御性）→ 同样广播而不是静默", async () => {
    const { hub, ws, next } = makeHub(async () => {
      throw new Error("kernel exploded");
    });

    handleChatMessage(hub, ws, JSON.stringify({ type: "user_response", payload: { interaction_id: "i1" } }));
    const event = await next();

    expect(event.type).toBe("action_failed");
    expect(event.payload.action).toBe("应答");
    expect(event.payload.message).toContain("kernel exploded");
  });

  test("五条路径全部接线：plan_action / set_plan_mode / checkpoint_action 逐个验证", async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const { hub, ws, next, log } = makeHub(async (method, params) => {
      calls.push({ method, params });
      return { ok: false, error: `deny:${method}` };
    });

    handleChatMessage(hub, ws, JSON.stringify({ type: "plan_response", payload: { plan_id: "p1", action: "approve" } }));
    expect((await next()).payload.action).toBe("计划操作");

    handleChatMessage(hub, ws, JSON.stringify({ type: "set_plan_mode", payload: { enabled: true } }));
    expect((await next()).payload.action).toBe("计划模式");

    handleChatMessage(hub, ws, JSON.stringify({ type: "checkpoint_action", payload: { action: "create" } }));
    expect((await next()).payload.action).toBe("检查点操作");

    expect(calls.map((c) => c.method)).toEqual(["plan_action", "set_plan_mode", "checkpoint_action"]);
    expect(log.every((b) => String(b.payload.message).startsWith("deny:"))).toBe(true);
  });
});
