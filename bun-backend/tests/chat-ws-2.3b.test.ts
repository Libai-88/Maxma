/**
 * tests/chat-ws-2.3b.test.ts — 回合富化层单测（阶段 2.3b）。
 *
 * mock hub（callRpc 桩 + broadcast 捕获）驱动 handleChatMessage + onKernelEvent：
 * turn_id 富化 / answer 吞流+done 重合成 / 工具截断 / artifact 合成 /
 * memory 事件流 / deferred 写入 / cancel 闭合 / WS 限流。
 * 全部内联构造（规避 bun test 跨目录动态 import 挂起）。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let dataDir = "";
let prevDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-ws23b-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

interface FakeWs {
  data: { sessionId: string };
  send: (d: string) => void;
}

function makeHub(sid: string, opts: { messages?: Array<Record<string, unknown>> } = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const conns = new Map<string, Set<FakeWs>>();
  const ws: FakeWs = { data: { sessionId: sid }, send: (d: string) => sent.push(JSON.parse(d)) };
  conns.set(sid, new Set([ws]));
  const promptCalls: Array<Record<string, unknown>> = [];
  const rpcCalls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const hub = {
    sessions: new Map<string, { currentGuard: unknown }>(),
    pendingPlans: new Map(),
    connections: conns,
    seenClientMsgIds: new Map<string, string[]>(),
    callRpc: async (method: string, params: Record<string, unknown>) => {
      rpcCalls.push({ method, params });
      if (method === "prompt") {
        promptCalls.push(params);
        return { ok: true as const, result: { ok: true } };
      }
      if (method === "get_messages") {
        return { ok: true as const, result: { messages: opts.messages ?? [], total: (opts.messages ?? []).length } };
      }
      if (method === "cancel") return { ok: true as const, result: { ok: true } };
      return { ok: true as const, result: {} };
    },
    broadcast: (s: string, e: Record<string, unknown>) => {
      const set = conns.get(s);
      if (set) for (const w of set) w.send(JSON.stringify(e));
    },
  };
  return { hub, ws, sent, promptCalls, rpcCalls };
}

describe("回合富化层（阶段 2.3b）", () => {
  test("chat → turn_start 埋点 + prompt 下发；token 事件携带本轮 turn_id", async () => {
    const { onKernelEvent, handleChatMessage } = await import("../src/routes/chat-ws");
    const { getActivityHub } = await import("../src/activity-hub");
    const sid = "sess-turn-1";
    const { hub, ws, sent, promptCalls } = makeHub(sid);

    handleChatMessage(hub as never, ws as never, JSON.stringify({ type: "chat", payload: { message: "你好" } }));
    await Bun.sleep(10);
    expect(promptCalls.length).toBe(1);

    const acts = getActivityHub().listBySession(sid);
    expect(acts.some((a) => a.event_type === "turn_start")).toBe(true);

    await onKernelEvent(hub as never, sid, { type: "token", payload: { token: "你" } });
    const tok = sent.find((f) => f.type === "token") as { payload: { token: string; turn_id: string } };
    expect(tok.payload.token).toBe("你");
    expect(typeof tok.payload.turn_id).toBe("string");
    expect(tok.payload.turn_id.length).toBeGreaterThan(0);
  }, 15000);

  test("answer 吞流、done 重合成 answer(turn_id)+done(context_usage,empty)", async () => {
    const { onKernelEvent, handleChatMessage } = await import("../src/routes/chat-ws");
    const sid = "sess-turn-2";
    const { hub, ws, sent } = makeHub(sid, {
      messages: [{ role: "user", content: "问题" }, { role: "assistant", content: "回答内容" }],
    });

    handleChatMessage(hub as never, ws as never, JSON.stringify({ type: "chat", payload: { message: "问题" } }));
    await Bun.sleep(10);

    // answer 事件本身不下发（吞流捕获）
    await onKernelEvent(hub as never, sid, { type: "answer", payload: { content: "回答内容" } });
    expect(sent.filter((f) => f.type === "answer").length).toBe(0);

    // done 到达 → 重发 answer + done
    await onKernelEvent(hub as never, sid, { type: "done", payload: {} });

    const answer = sent.find((f) => f.type === "answer") as { payload: { content: string; turn_id: string } };
    expect(answer.payload.content).toBe("回答内容");
    const done = sent.find((f) => f.type === "done") as {
      payload: { turn_id: string; context_usage: Record<string, unknown>; empty: boolean };
    };
    expect(done.payload.turn_id).toBe(answer.payload.turn_id);
    expect(done.payload.empty).toBe(false);
    expect(done.payload.context_usage).toBeDefined();
    expect(done.payload.context_usage.message_count).toBe(2);
  }, 15000);

  test("空回复 → done.empty=true，无 answer", async () => {
    const { onKernelEvent, handleChatMessage } = await import("../src/routes/chat-ws");
    const sid = "sess-turn-empty";
    const { hub, ws, sent } = makeHub(sid);
    handleChatMessage(hub as never, ws as never, JSON.stringify({ type: "chat", payload: { message: "hi" } }));
    await Bun.sleep(10);
    await onKernelEvent(hub as never, sid, { type: "done", payload: {} });
    const done = sent.find((f) => f.type === "done") as { payload: { empty: boolean } };
    expect(done.payload.empty).toBe(true);
    expect(sent.some((f) => f.type === "answer")).toBe(false);
  }, 15000);

  test("tool_end 输出 >100KB 截断 + truncated 标记", async () => {
    const { onKernelEvent, handleChatMessage } = await import("../src/routes/chat-ws");
    const sid = "sess-tool-trunc";
    const { hub, ws, sent } = makeHub(sid);
    handleChatMessage(hub as never, ws as never, JSON.stringify({ type: "chat", payload: { message: "x" } }));
    await Bun.sleep(10);
    const big = "A".repeat(120_000);
    await onKernelEvent(hub as never, sid, { type: "tool_end", payload: { tool_name: "bash", output: big, elapsed: 1 } });
    const te = sent.find((f) => f.type === "tool_end") as { payload: { output: string; truncated: boolean } };
    expect(te.payload.truncated).toBe(true);
    expect(te.payload.output.length).toBeLessThan(big.length);
    expect(te.payload.output).toContain("已截断");
  }, 15000);

  test("写类工具 tool_end → 合成 artifact 事件（真实文件）", async () => {
    const { onKernelEvent, handleChatMessage } = await import("../src/routes/chat-ws");
    const sid = "sess-artifact";
    const { hub, ws, sent } = makeHub(sid);
    const file = path.join(dataDir, "out.txt");
    fs.writeFileSync(file, "hello artifact");
    handleChatMessage(hub as never, ws as never, JSON.stringify({ type: "chat", payload: { message: "写文件" } }));
    await Bun.sleep(10);
    const output = JSON.stringify({ content: [{ type: "text", text: `Successfully wrote 14 bytes to ${file}` }] });
    await onKernelEvent(hub as never, sid, { type: "tool_end", payload: { tool_name: "write", output, elapsed: 1 } });
    const art = sent.find((f) => f.type === "artifact") as { payload: { title: string; body: string } };
    expect(art).toBeDefined();
    expect(art.payload.title).toBe("out.txt");
    expect(art.payload.body).toContain("hello artifact");
  }, 15000);

  test("remember_memory 工具 → done 后合成 memory_* 事件流", async () => {
    const { onKernelEvent, handleChatMessage } = await import("../src/routes/chat-ws");
    const sid = "sess-memory";
    const { hub, ws, sent } = makeHub(sid);
    handleChatMessage(hub as never, ws as never, JSON.stringify({ type: "chat", payload: { message: "记住" } }));
    await Bun.sleep(10);
    await onKernelEvent(hub as never, sid, { type: "tool_start", payload: { tool_name: "remember_memory", input: "k" } });
    await onKernelEvent(hub as never, sid, { type: "tool_end", payload: { tool_name: "remember_memory", output: "ok", elapsed: 1 } });
    await onKernelEvent(hub as never, sid, { type: "answer", payload: { content: "已记住" } });
    await onKernelEvent(hub as never, sid, { type: "done", payload: {} });

    const types = sent.map((f) => f.type);
    const doneIdx = types.indexOf("done");
    const startIdx = types.indexOf("memory_start");
    const endIdx = types.indexOf("memory_done");
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(-1);
    expect(startIdx).toBeGreaterThan(doneIdx); // memory 事件在 done 之后到达
    const ms = sent[startIdx] as { payload: { turn_id: string } };
    const done = sent[doneIdx] as { payload: { turn_id: string } };
    expect(ms.payload.turn_id).toBe(done.payload.turn_id);
  }, 15000);

  test("deferred_subagent_submitted → 写入 DeferredRunManager + 原样转发", async () => {
    const { onKernelEvent, handleChatMessage } = await import("../src/routes/chat-ws");
    const { initializeDatabase } = await import("../src/db/core");
    const { getDeferredRunManager } = await import("../src/routes/deferred-runs");
    initializeDatabase();
    const sid = "sess-deferred";
    const { hub, ws, sent } = makeHub(sid);
    handleChatMessage(hub as never, ws as never, JSON.stringify({ type: "chat", payload: { message: "子任务" } }));
    await Bun.sleep(10);
    await onKernelEvent(hub as never, sid, {
      type: "deferred_subagent_submitted",
      payload: { run_id: "run-1", status: "completed", task: "t", name: "n" },
    });
    const fwd = sent.find((f) => f.type === "deferred_subagent_submitted") as { payload: { run_id: string } };
    expect(fwd.payload.run_id).toBe("run-1");
    const stored = getDeferredRunManager().getRun(sid, "run-1");
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe("succeeded"); // completed → succeeded 生命周期映射
  }, 15000);

  test("cancel 在途回合 → done{cancelled:true}", async () => {
    const { onKernelEvent, handleChatMessage } = await import("../src/routes/chat-ws");
    const sid = "sess-cancel";
    const { hub, ws, sent } = makeHub(sid);
    handleChatMessage(hub as never, ws as never, JSON.stringify({ type: "chat", payload: { message: "慢活" } }));
    await Bun.sleep(10);
    hub.sessions.set(sid, { currentGuard: {} }); // 模拟 kernel 在途 guard
    handleChatMessage(hub as never, ws as never, JSON.stringify({ type: "cancel", payload: {} }));
    await Bun.sleep(30);
    await onKernelEvent(hub as never, sid, { type: "done", payload: {} });
    const done = sent.find((f) => f.type === "done") as { payload: { cancelled: boolean } };
    expect(done.payload.cancelled).toBe(true);
  }, 15000);

  test("多次模型响应、缺失用量和 cache_warm 分别写入用量账本", async () => {
    const { onKernelEvent, handleChatMessage } = await import("../src/routes/chat-ws");
    const { getRecentLlmUsageCalls } = await import("../src/llm-usage-ledger");
    const { getMetrics } = await import("../src/metrics");
    const before = getMetrics().getSnapshot().llm;
    const sid = "sess-llm-usage-ledger";
    const { hub, ws, sent, promptCalls } = makeHub(sid);
    handleChatMessage(hub as never, ws as never, JSON.stringify({ type: "chat", payload: { message: "测试用量" } }));
    await Bun.sleep(10);
    expect(promptCalls.length).toBe(1);

    await onKernelEvent(hub as never, sid, {
      type: "answer",
      payload: {
        content: "",
        provider: "openai",
        model: "gpt-test",
        request_duration_ms: 120,
        usage: { input: 100, output: 10, cacheRead: 30, cacheWrite: 0, cost: { input: 0.001, output: 0.002, cacheRead: 0.0001, cacheWrite: 0, total: 0.0031 } },
      },
    });
    await onKernelEvent(hub as never, sid, {
      type: "answer",
      payload: {
        content: "",
        provider: "openai",
        model: "gpt-test",
        request_duration_ms: 220,
        usage: { input: 50, output: 8, cacheRead: 20, cacheWrite: 0, cost: { input: 0.001, output: 0.001, cacheRead: 0.0001, cacheWrite: 0, total: 0.0021 } },
      },
    });
    await onKernelEvent(hub as never, sid, {
      type: "answer",
      payload: { content: "done", provider: "custom-free", model: "free-test", usage: null },
    });
    await onKernelEvent(hub as never, sid, { type: "done", payload: {} });
    await onKernelEvent(hub as never, sid, {
      type: "llm_usage",
      payload: {
        kind: "cache_warm",
        usage_source: "pi_usage_entry",
        usage_entry_id: "warm-entry-test",
        occurred_at: new Date().toISOString(),
        provider: "openai",
        model: "gpt-test",
        usage: { input: 0, output: 0, cacheRead: 70, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0.0002, cacheWrite: 0, total: 0.0002 } },
      },
    });

    const rows = getRecentLlmUsageCalls({ windowSeconds: 86_400 });
    const sessionRows = rows.filter((row) => row.session_id === sid);
    expect(sessionRows).toHaveLength(4);
    expect(sessionRows.filter((row) => row.kind === "model_request").map((row) => row.request_index)).toEqual([3, 2, 1]);
    expect(sessionRows.find((row) => row.usage_status === "missing")).toMatchObject({
      input_tokens: null,
      output_tokens: null,
      cost_total: null,
      cost_status: "unknown",
    });
    expect(sessionRows.find((row) => row.kind === "cache_warm")).toMatchObject({
      turn_id: null,
      source_entry_id: `${sid}:warm-entry-test`,
      cache_read_tokens: 70,
      cost_total: null,
      cost_status: "unknown",
    });
    const completed = sent.find((event) => event.type === "done") as { payload: { context_usage: Record<string, unknown> } };
    expect(completed.payload.context_usage).toMatchObject({
      model_request_count: 3,
      usage_status: "partial",
      input_tokens: null,
      cache_hit_rate: null,
    });
    const after = getMetrics().getSnapshot().llm;
    expect(after.total_calls - before.total_calls).toBe(3);
    expect(after.missing_usage_calls - before.missing_usage_calls).toBe(1);
    expect(after.cache_warm_calls - before.cache_warm_calls).toBe(1);
  }, 15000);
  test("WS 限流：超过 capacity 后 chat → error{RATE_LIMITED}", async () => {
    const { onKernelEvent, handleChatMessage } = await import("../src/routes/chat-ws");
    const sid = "sess-ratelimit";
    const { hub, ws, sent } = makeHub(sid);
    // 每轮 chat 后补 done 清除回合状态（否则 CONN-MUTEX BUSY 先于限流触发）
    for (let i = 0; i < 60; i++) {
      handleChatMessage(hub as never, ws as never, JSON.stringify({ type: "chat", payload: { message: `m${i}` } }));
      await onKernelEvent(hub as never, sid, { type: "done", payload: {} });
    }
    expect(sent.filter((f) => f.type === "error").length).toBe(0);
    handleChatMessage(hub as never, ws as never, JSON.stringify({ type: "chat", payload: { message: "over" } }));
    const err = sent.find((f) => f.type === "error") as { payload: { code: string; category: string } };
    expect(err.payload.code).toBe("RATE_LIMITED");
    expect(err.payload.category).toBe("rate_limit");
  }, 15000);

  test("steer/follow_up → 调用对应 RPC 并广播 queued", async () => {
    const { handleChatMessage } = await import("../src/routes/chat-ws");
    const sid = "sess-collaboration-rpc";
    const { hub, ws, sent, rpcCalls } = makeHub(sid);

    handleChatMessage(hub as never, ws as never, JSON.stringify({ type: "chat", payload: { message: "执行任务" } }));
    await Bun.sleep(10);
    hub.sessions.set(sid, { currentGuard: {} } as never);
    handleChatMessage(hub as never, ws as never, JSON.stringify({ type: "steer", payload: { message: "改用中文输出" } }));
    handleChatMessage(hub as never, ws as never, JSON.stringify({ type: "follow_up", payload: { message: "完成后补充摘要" } }));
    await Bun.sleep(10);

    expect(rpcCalls.filter((call) => call.method === "steer")).toHaveLength(1);
    expect(rpcCalls.filter((call) => call.method === "follow_up")).toHaveLength(1);
    expect(sent.filter((event) => event.type === "collaboration_update").map((event) => (event.payload as { status: string }).status))
      .toEqual(["queued", "queued"]);
  }, 15000);

  test("完成回合后可接受验收，并按反馈开启修订回合", async () => {
    const { handleChatMessage, onKernelEvent } = await import("../src/routes/chat-ws");
    const sid = "sess-task-review";
    const { hub, ws, sent, promptCalls } = makeHub(sid);

    handleChatMessage(hub as never, ws as never, JSON.stringify({ type: "chat", payload: { message: "生成结果" } }));
    await Bun.sleep(10);
    await onKernelEvent(hub as never, sid, { type: "answer", payload: { content: "初始结果" } });
    await onKernelEvent(hub as never, sid, { type: "done", payload: {} });
    expect(sent.find((event) => event.type === "task_review_update")?.payload).toMatchObject({ status: "available" });

    handleChatMessage(hub as never, ws as never, JSON.stringify({ type: "task_review", payload: { action: "revise", feedback: "补充边界条件" } }));
    await Bun.sleep(10);
    expect(sent.filter((event) => event.type === "task_review_update").at(-1)?.payload).toMatchObject({ status: "revising" });
    expect(promptCalls).toHaveLength(2);

    await onKernelEvent(hub as never, sid, { type: "answer", payload: { content: "修订结果" } });
    await onKernelEvent(hub as never, sid, { type: "done", payload: {} });
    handleChatMessage(hub as never, ws as never, JSON.stringify({ type: "task_review", payload: { action: "accept" } }));
    await Bun.sleep(5);
    expect(sent.filter((event) => event.type === "task_review_update").at(-1)?.payload).toMatchObject({ status: "accepted" });
  }, 15000);

  test("最后一个连接断开会取消在途回合", async () => {
    const { handleChatMessage, registerChatConnection, unregisterChatConnection } = await import("../src/routes/chat-ws");
    const sid = "sess-disconnect-cancel";
    const { hub, ws, rpcCalls } = makeHub(sid);
    registerChatConnection(hub as never, sid, ws as never);
    handleChatMessage(hub as never, ws as never, JSON.stringify({ type: "chat", payload: { message: "长任务" } }));
    await Bun.sleep(10);
    hub.sessions.set(sid, { currentGuard: {} } as never);
    unregisterChatConnection(hub as never, sid, ws as never);
    await Bun.sleep(5);
    expect(rpcCalls.some((call) => call.method === "cancel")).toBe(true);
  }, 15000);
});
