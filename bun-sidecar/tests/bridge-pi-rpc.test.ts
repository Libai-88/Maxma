/**
 * tests/bridge-pi-rpc.test.ts — bridge-pi.ts 的订阅层与 RPC 分支覆盖
 * （COV-PASS-001 的配套：覆盖率门槛修好后，bridge-pi 必须自己达标）。
 *
 * 这里只断言**契约可观察的结果**（回执/错误/事件/会话状态变化），
 * 不发模型请求、不联网。订阅层用假 session 驱动真实事件形状；
 * RPC 层用 in-memory 真会话（与 kernel-bridge.test.ts 同口径）。
 */

import { describe, expect, test } from "bun:test";

import {
  handlePiCreateSession,
  handlePiSessionRpc,
  subscribePiSession,
  MAX_TOOL_CALLS_PER_TURN,
  type PiBridgeIo,
  type PiSessionRecord,
} from "../src/kernel/bridge-pi";

function fakeIo() {
  const replies: Array<{ id: number | null; result: unknown }> = [];
  const errors: Array<{ id: number | null; message: string }> = [];
  const events: Array<{ sessionId: string; event: { type: string; payload: Record<string, unknown> } }> = [];
  const io: PiBridgeIo = {
    send: (id, result) => replies.push({ id, result }),
    sendError: (id, message) => errors.push({ id, message }),
    sendEvent: (sessionId, event) => events.push({ sessionId, event }),
  };
  return { io, replies, errors, events };
}

// ── 订阅层（subscribePiSession）────────────────────────────
//
// 这一层此前 0 测试：它决定「引擎事件 → 前端事件」的转发、工具循环熔断
// （TOOL-LOOP-GUARD-001）与闲置回顾静默（RECAP-SILENT-001），
// 三条都是用户可感知的行为，且都不需要真实模型就能验证。

interface FakeSession {
  handler: ((event: unknown) => void) | null;
  aborted: number;
  model: { provider: string; id: string; name: string } | undefined;
  subscribe(fn: (event: unknown) => void): () => void;
  abort(): Promise<void>;
}

function fakeRecord(session: FakeSession): PiSessionRecord {
  return {
    engine: "pi",
    session: session as unknown as PiSessionRecord["session"],
    unsubscribe: () => {},
    promptQueue: Promise.resolve(),
    currentGuard: null,
    toolCallCount: 0,
    permissionMode: "ask",
    approvalGate: undefined as unknown as PiSessionRecord["approvalGate"],
    planMode: false,
    goalState: { enabled: false, mode: "idle", goal: null } as PiSessionRecord["goalState"],
    suppressEvents: false,
    modelRequestStartedAt: null,
    modelPriceStatus: "catalog_estimate",
    modelCacheStatus: "catalog",
    latestRequestTelemetry: null,
    requestFingerprintSecret: new Uint8Array(8),
    requestFingerprintEpoch: "epoch-1",
    extensionUi: undefined as unknown as PiSessionRecord["extensionUi"],
  };
}

function makeFakeSession(model = { provider: "acme", id: "m-1", name: "M1" }): FakeSession {
  return {
    handler: null,
    aborted: 0,
    model,
    subscribe(fn) {
      this.handler = fn;
      return () => {
        this.handler = null;
      };
    },
    async abort() {
      this.aborted += 1;
    },
  };
}

describe("kernel: subscribePiSession", () => {
  test("message_start(assistant) 记录请求起点；message_end(assistant) 转发 answer 并复位", () => {
    const session = makeFakeSession();
    const record = fakeRecord(session);
    const { io, events } = fakeIo();
    const unsubscribe = subscribePiSession("s-1", record, io);
    expect(typeof unsubscribe).toBe("function");

    session.handler!({ type: "message_start", message: { role: "assistant" } });
    expect(record.modelRequestStartedAt).not.toBeNull();

    session.handler!({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "收到" }] },
    });
    const answer = events.find((e) => e.event.type === "answer");
    expect(answer).toBeDefined();
    expect((answer!.event.payload as { content: string }).content).toBe("收到");
    // 一轮结束必须复位，否则下一轮的 duration 会从上一轮开始计时
    expect(record.modelRequestStartedAt).toBeNull();
  });

  test("user 的 message_end 不转发（子 Agent 的用户消息不该被当成回答）", () => {
    const session = makeFakeSession();
    const record = fakeRecord(session);
    const { io, events } = fakeIo();
    subscribePiSession("s-2", record, io);

    session.handler!({ type: "message_end", message: { role: "user", content: "hi" } });
    expect(events.length).toBe(0);
  });

  test("工具循环熔断：超过上限发 TOOL_LOOP_LIMIT + done 并 abort，且只发一次", async () => {
    const session = makeFakeSession();
    const record = fakeRecord(session);
    const { io, events } = fakeIo();
    const guard = { done: false };
    record.currentGuard = guard as PiSessionRecord["currentGuard"];
    subscribePiSession("s-3", record, io);

    for (let i = 0; i < MAX_TOOL_CALLS_PER_TURN; i += 1) {
      session.handler!({ type: "tool_execution_start", toolCallId: `cov-${i}`, toolName: "bash", args: {} });
    }
    // 上限内的调用只映射为 tool_start，不熔断
    expect(events.filter((e) => e.event.type === "tool_start").length).toBe(MAX_TOOL_CALLS_PER_TURN);
    expect(guard.done).toBe(false);

    // 第 51 次 → 熔断
    session.handler!({ type: "tool_execution_start", toolCallId: "cov-over", toolName: "bash", args: {} });
    const err = events.find((e) => e.event.type === "error");
    expect(err).toBeDefined();
    expect((err!.event.payload as { code: string }).code).toBe("TOOL_LOOP_LIMIT");
    expect(events.some((e) => e.event.type === "done")).toBe(true);
    expect(guard.done).toBe(true);
    await Promise.resolve();
    expect(session.aborted).toBe(1);

    // 已熔断后继续来的 tool_start 不应再发第二次 done
    session.handler!({ type: "tool_execution_start", toolCallId: "cov-over2", toolName: "bash", args: {} });
    expect(events.filter((e) => e.event.type === "done").length).toBe(1);
    expect(events.filter((e) => e.event.type === "tool_start").length).toBe(MAX_TOOL_CALLS_PER_TURN);
  });

  test("闲置回顾静默：suppressEvents 期间丢弃流式与工具事件，只把用量回执成 llm_usage", () => {
    const session = makeFakeSession();
    const record = fakeRecord(session);
    record.suppressEvents = true;
    record.modelRequestStartedAt = 1000;
    const { io, events } = fakeIo();
    subscribePiSession("s-4", record, io);

    // 流式正文与工具事件：必须全部丢弃（回顾内容不得泄漏给前端）
    session.handler!({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "回顾中" } });
    session.handler!({ type: "tool_execution_start", toolCallId: "cov-r1", toolName: "read", args: {} });
    expect(events.length).toBe(0);

    // 但用量要进账：assistant 收尾时把 answer 的 usage 重写成 llm_usage
    session.handler!({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "回顾完成" }] },
    });
    const usage = events.find((e) => e.event.type === "llm_usage");
    expect(usage).toBeDefined();
    expect((usage!.event.payload as { usage_source: string }).usage_source).toBe("pi_message_end");
    // 回顾的内容本身一个 token 都不能出现在事件里
    expect(events.some((e) => e.event.type === "token" || e.event.type === "answer")).toBe(false);
    expect(record.modelRequestStartedAt).toBeNull();
    expect(record.suppressEvents).toBe(true);
  });

  test("闲置回顾静默：cache_warm 只在与当前模型同 provider/model 时才沿用目录价态", () => {
    const session = makeFakeSession({ provider: "acme", id: "m-1", name: "M1" });
    const record = fakeRecord(session);
    record.suppressEvents = true;
    const { io, events } = fakeIo();
    subscribePiSession("s-5", record, io);

    session.handler!({
      type: "entry_appended",
      entry: { type: "usage", kind: "cache_warm", provider: "acme", model: "m-1" },
    });
    // 匹配 → 用会话登记的价态（catalog_estimate）
    const matched = events.find((e) => e.event.type === "llm_usage");
    expect(matched).toBeDefined();
    expect((matched!.event.payload as { price_status: string }).price_status).toBe("catalog_estimate");

    // 不匹配的 provider → 价态降级为 unknown（不许把别的模型的目录价按到它头上）
    session.handler!({
      type: "entry_appended",
      entry: { type: "usage", kind: "cache_warm", provider: "other", model: "m-9" },
    });
    const second = events.filter((e) => e.event.type === "llm_usage")[1]!;
    expect((second.event.payload as { price_status: string }).price_status).toBe("unknown");
  });

  test("静默态之外的 cache_warm 走常规映射，不吞事件", () => {
    const session = makeFakeSession();
    const record = fakeRecord(session);
    const { io, events } = fakeIo();
    subscribePiSession("s-6", record, io);

    session.handler!({
      type: "entry_appended",
      entry: { type: "usage", kind: "cache_warm", provider: "acme", model: "m-1" },
    });
    expect(events.some((e) => e.event.type === "llm_usage")).toBe(true);
  });
});

// ── RPC 分支 ───────────────────────────────────────────────

async function newSession(params: Record<string, unknown> = {}, id = 100) {
  const { io, replies, errors, events } = fakeIo();
  const sessions = new Map<string, PiSessionRecord>();
  const pendingPlans = new Map();
  await handlePiCreateSession({ io, sessions, pendingPlans }, { cwd: import.meta.dir, in_memory: true, ...params }, id);
  const sid = (replies[0]!.result as { session_id: string }).session_id;
  const rpc = (method: string, patch: Record<string, unknown> = {}, callId = 0) =>
    handlePiSessionRpc({ io, sessions, pendingPlans }, method, sid, patch, callId);
  return { io, replies, errors, events, sessions, pendingPlans, sid, rpc };
}

function resultOf<T = Record<string, unknown>>(replies: Array<{ id: number | null; result: unknown }>, id: number): T {
  const hit = replies.find((r) => r.id === id);
  expect(hit).toBeDefined();
  return hit!.result as T;
}

describe("kernel: pi RPC 覆盖（状态/树/编辑/导出/权限）", () => {
  test("未知会话 → 明确报错，不静默吞掉", async () => {
    const { io, errors } = fakeIo();
    const sessions = new Map<string, PiSessionRecord>();
    await handlePiSessionRpc({ io, sessions, pendingPlans: new Map() }, "get_health", "nope", {}, 7);
    expect(errors.some((e) => e.id === 7 && e.message.includes("not found"))).toBe(true);
  });

  test("prompt 缺 message → 参数错误（不是把空串发给引擎）", async () => {
    const { errors, rpc } = await newSession();
    await rpc("prompt", {}, 11);
    expect(errors.some((e) => e.id === 11 && e.message.includes("Missing required parameter: message"))).toBe(true);
  });

  test("get_session_state 暴露选中模型/路由模型/思考档位", async () => {
    const { replies, rpc } = await newSession({ thinking_level: "medium" }, 20);
    await rpc("get_session_state", {}, 21);
    const state = resultOf<{ model: { id?: string } | null; thinking_level: string; is_streaming: boolean; is_idle: boolean }>(replies, 21);
    expect(state.model).not.toBeNull();
    expect(typeof state.model!.id).toBe("string");
    // 档位由引擎按当前模型裁剪后自报（实测空闲 in-memory 会话回落为 off，
    // 不因为请求了 medium 就撒谎说成 medium）
    expect(typeof state.thinking_level).toBe("string");
    expect(state.thinking_level.length).toBeGreaterThan(0);
    expect(state.is_streaming).toBe(false);
    expect(typeof state.is_idle).toBe("boolean");
  });

  test("follow_up / steer 把消息交给引擎并回执 disposition", async () => {
    const { replies, errors, rpc } = await newSession({}, 30);
    await rpc("follow_up", { message: "  稍后继续  " }, 31);
    const fu = resultOf<{ ok: boolean; disposition?: string }>(replies, 31);
    expect(fu.ok).toBe(true);
    // 空闲会话的排队语义由引擎给出，Maxma 原样透传（不自己发明状态）
    expect(typeof fu.disposition).toBe("string");

    await rpc("steer", { message: "改个方向" }, 32);
    expect(resultOf<{ ok: boolean }>(replies, 32).ok).toBe(true);

    // 空白消息必须被拒（trim 后为空）→ 参数错误，不是把空串塞给引擎
    await rpc("steer", { message: "   " }, 33);
    expect(errors.some((e) => e.id === 33 && e.message.includes("Missing required parameter: message"))).toBe(true);
    expect(replies.some((r) => r.id === 33)).toBe(false);
  });

  test("user_response / extension_ui_response：缺参数报错，未命中不报错", async () => {
    const { replies, errors, rpc } = await newSession({}, 40);
    await rpc("user_response", { interaction_id: "x" }, 41);
    expect(errors.some((e) => e.id === 41)).toBe(true);

    await rpc("user_response", { interaction_id: "no-such", response: "yes" }, 42);
    expect(resultOf<{ ok: boolean }>(replies, 42).ok).toBe(true);

    await rpc("extension_ui_response", {}, 43);
    expect(errors.some((e) => e.id === 43 && e.message.includes("Missing required parameter: id"))).toBe(true);

    // 迟到的应答（对话框已超时/被撤下）→ ok:true + matched:false，不算错误
    await rpc("extension_ui_response", { id: "gone", value: "v" }, 44);
    const late = resultOf<{ ok: boolean; matched: boolean }>(replies, 44);
    expect(late.ok).toBe(true);
    expect(late.matched).toBe(false);
  });

  test("set_auto_approve 写档位并广播；切 auto 时放行挂起审批", async () => {
    const { events, sessions, sid, rpc } = await newSession({}, 50);
    await rpc("set_auto_approve", { auto_approve: true }, 51);
    expect(sessions.get(sid)!.permissionMode).toBe("auto");
    expect(events.some((e) => e.event.type === "permission_mode_updated" && (e.event.payload as { permission_mode: string }).permission_mode === "auto")).toBe(true);
  });

  test("set_permission_mode：四档之外显式拒绝；合法档位广播事件", async () => {
    const { replies, errors, events, sessions, sid, rpc } = await newSession({}, 60);
    await rpc("set_permission_mode", { permission_mode: "god" }, 61);
    expect(errors.some((e) => e.id === 61 && e.message.includes("不支持的权限模式"))).toBe(true);

    await rpc("set_permission_mode", { permission_mode: "read_only" }, 62);
    expect(resultOf<{ permission_mode: string }>(replies, 62).permission_mode).toBe("read_only");
    expect(sessions.get(sid)!.permissionMode).toBe("read_only");
    expect(events.some((e) => e.event.type === "permission_mode_updated")).toBe(true);
  });

  test("reload_mcp_for_session 是显式 noop（不假装热重载）", async () => {
    const { replies, rpc } = await newSession({}, 70);
    await rpc("reload_mcp_for_session", {}, 71);
    expect(resultOf<{ status: string }>(replies, 71).status).toBe("noop");
  });

  test("get_settings 只回显存在的点路径；set_settings 缺 path 报错", async () => {
    const { replies, errors, rpc } = await newSession({}, 80);
    await rpc("get_settings", { paths: ["compaction.thresholdPercent", "no.such.path"] }, 81);
    const got = resultOf<{ settings: Record<string, unknown> }>(replies, 81);
    // 未知路径静默跳过（不是塞 null）
    expect(Object.keys(got.settings)).not.toContain("no.such.path");

    await rpc("set_settings", { value: 1 }, 82);
    expect(errors.some((e) => e.id === 82 && e.message.includes("Missing required parameter: path"))).toBe(true);
  });

  test("set_settings 写入合法点路径并回 ok", async () => {
    const { replies, rpc } = await newSession({}, 90);
    await rpc("set_settings", { path: "compaction.thresholdPercent", value: 80 }, 91);
    expect(resultOf<{ ok?: boolean }>(replies, 91).ok).toBe(true);
  });

  test("undo：没有用户回合 → 明确 0 撤回；有用户回合 → 叶指针回退", async () => {
    const { replies, sessions, sid, rpc } = await newSession({}, 100);
    await rpc("undo", {}, 101);
    expect(resultOf<{ removed: number; turns_removed: number }>(replies, 101)).toEqual({ removed: 0, turns_removed: 0, detail: "no turns to undo" });

    const sm = sessions.get(sid)!.session.sessionManager;
    sm.appendMessage({ role: "user", content: "第一轮", timestamp: Date.now() });
    await rpc("undo", { steps: 1 }, 102);
    const undone = resultOf<{ turns_removed: number }>(replies, 102);
    expect(undone.turns_removed).toBe(1);
  });

  test("checkpoint_action：未知动作报错；无书签时 restore 明确 restored:false", async () => {
    const { replies, errors, sessions, sid, rpc } = await newSession({}, 110);
    await rpc("checkpoint_action", { action: "rewind" }, 111);
    expect(errors.some((e) => e.id === 111 && e.message.includes("Unknown checkpoint action"))).toBe(true);

    const sm = sessions.get(sid)!.session.sessionManager;
    sm.appendMessage({ role: "user", content: "只有消息没有书签", timestamp: Date.now() });
    await rpc("checkpoint_action", { action: "restore" }, 112);
    const restore = resultOf<{ restored: boolean }>(replies, 112);
    expect(restore.restored).toBe(false);
  });

  test("get_tree 只读投影：预览按角色渲染、超长截断、标签与叶子标记正确", async () => {
    const { replies, sessions, sid, rpc } = await newSession({}, 120);
    const sm = sessions.get(sid)!.session.sessionManager;
    const long = "很长的内容".repeat(30);
    const firstId = sm.appendMessage({ role: "user", content: long, timestamp: Date.now() });
    sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "回答内容" }], timestamp: Date.now() });
    const leafId = sm.getLeafId()!;
    sm.appendLabelChange(firstId, "检查点A");

    await rpc("get_tree", {}, 121);
    const tree = resultOf<{
      leaf_id: string | null;
      entry_count: number;
      tree: Array<{ preview: string; isLeaf: boolean; children: Array<Record<string, unknown>> }>;
    }>(replies, 121);
    expect(tree.entry_count).toBeGreaterThan(0);
    expect(typeof tree.leaf_id).toBe("string");
    const flat: Array<{ preview: string; isLeaf: boolean }> = [];
    const walk = (nodes: Array<{ preview: string; isLeaf: boolean; children?: unknown[] }>) => {
      for (const n of nodes) {
        flat.push({ preview: n.preview, isLeaf: n.isLeaf });
        walk((n.children ?? []) as Array<{ preview: string; isLeaf: boolean; children?: unknown[] }>);
      }
    };
    walk(tree.tree);

    // 用户消息预览带角色前缀，且超长被截断成单行 + 省略号
    const userNode = flat.find((n) => n.preview.startsWith("user: "))!;
    expect(userNode).toBeDefined();
    expect(userNode.preview).toContain("…");
    expect(userNode.preview.includes("\n")).toBe(false);
    // assistant 的数组 content 只取 text 块
    expect(flat.some((n) => n.preview === "assistant: 回答内容")).toBe(true);
    // 书签条目预览 + 叶子标记
    expect(flat.some((n) => n.preview === "(书签)")).toBe(true);
    expect(flat.filter((n) => n.isLeaf).length).toBe(1);
    expect(leafId).toBeString();
  });

  test("navigate_tree：缺 target_id 报错；合法目标移动叶指针且不删条目", async () => {
    const { replies, errors, sessions, sid, rpc } = await newSession({}, 130);
    await rpc("navigate_tree", {}, 131);
    expect(errors.some((e) => e.id === 131 && e.message.includes("Missing required parameter: target_id"))).toBe(true);

    const sm = sessions.get(sid)!.session.sessionManager;
    const firstId = sm.appendMessage({ role: "user", content: "第一条", timestamp: Date.now() });
    sm.appendMessage({ role: "assistant", content: "答复", timestamp: Date.now() });
    const before = sm.getEntryCount();
    await rpc("navigate_tree", { target_id: firstId }, 132);
    const nav = resultOf<{ leaf_id: string | null }>(replies, 132);
    expect(nav.leaf_id).toBeString();
    // append-only：条目一个都不许少
    expect(sm.getEntryCount()).toBe(before);
  });

  test("fork_session：内存会话明确拒绝分叉（不吐引擎技术性异常）", async () => {
    const { errors, sessions, sid, rpc } = await newSession({}, 140);
    const sm = sessions.get(sid)!.session.sessionManager;
    const entryId = sm.appendMessage({ role: "user", content: "有内容了", timestamp: Date.now() });
    await rpc("fork_session", { entry_id: entryId }, 141);
    // inMemory 会话没有磁盘文件 → 可读原因，而不是 SessionManager 抛错
    expect(errors.some((e) => e.id === 141 && e.message.includes("未持久化"))).toBe(true);

    await rpc("fork_session", {}, 142);
    expect(errors.some((e) => e.id === 142 && e.message.includes("Missing required parameter: entry_id"))).toBe(true);
  });

  test("abort_compaction / get_thinking_levels / get_context_usage 都有明确回执", async () => {
    const { replies, rpc } = await newSession({}, 150);
    await rpc("abort_compaction", {}, 151);
    const aborted = resultOf<{ ok: boolean; aborted: string }>(replies, 151);
    expect(aborted.ok).toBe(true);
    expect(aborted.aborted).toBe("compaction");

    await rpc("abort_compaction", { what: "branch_summary" }, 152);
    expect(resultOf<{ aborted: string }>(replies, 152).aborted).toBe("branch_summary");

    await rpc("get_thinking_levels", {}, 153);
    const levels = resultOf<{ available: string[]; current: string }>(replies, 153);
    expect(Array.isArray(levels.available)).toBe(true);
    expect(levels.available.length).toBeGreaterThan(0);

    await rpc("get_context_usage", {}, 154);
    const usage = resultOf<{ known: boolean; usage: unknown }>(replies, 154);
    expect(typeof usage.known).toBe("boolean");
  });

  test("context_edit：缺 target 报错、未知 entry 报错、omit 与替换都落成 append 式编辑", async () => {
    const { replies, errors, sessions, sid, rpc } = await newSession({}, 160);
    await rpc("context_edit", {}, 161);
    expect(errors.some((e) => e.id === 161 && e.message.includes("Missing required parameter: target_id"))).toBe(true);

    const sm = sessions.get(sid)!.session.sessionManager;
    const entryId = sm.appendMessage({ role: "user", content: "敏感内容", timestamp: Date.now() });

    await rpc("context_edit", { target_id: "no-such-entry" }, 162);
    expect(errors.some((e) => e.id === 162 && e.message.includes("找不到目标 entry"))).toBe(true);

    await rpc("context_edit", { target_id: entryId, omit: true }, 163);
    expect(resultOf<{ omitted: boolean; edit_id: string }>(replies, 163).omitted).toBe(true);

    await rpc("context_edit", { target_id: entryId, omit: false, replacement: "改写后的内容" }, 164);
    const replaced = resultOf<{ omitted: boolean }>(replies, 164);
    expect(replaced.omitted).toBe(false);
    // 原条目仍在（append-only）
    expect(sm.getEntry(entryId)).toBeDefined();
  });

  test("reload_session_resources 返回真实模板/工具计数", async () => {
    const { replies, rpc } = await newSession({}, 170);
    await rpc("reload_session_resources", {}, 171);
    const reloaded = resultOf<{ ok?: boolean; templates: number; tools: number }>(replies, 171);
    expect(reloaded.ok).toBe(true);
    expect(typeof reloaded.tools).toBe("number");
  });

  test("set_session_name：空串清除为 null，正常写入生效", async () => {
    const { replies, sessions, sid, rpc } = await newSession({}, 180);
    await rpc("set_session_name", { name: "  周报会话  " }, 181);
    expect(resultOf<{ name: string | null }>(replies, 181).name).toBe("周报会话");
    expect(sessions.get(sid)!.session.sessionManager.getSessionName()).toBe("周报会话");

    await rpc("set_session_name", { name: "   " }, 182);
    expect(resultOf<{ name: string | null }>(replies, 182).name).toBeNull();
  });

  test("list_prompt_templates / get_session_stats 透出引擎真实值", async () => {
    const { replies, rpc } = await newSession({}, 190);
    await rpc("list_prompt_templates", {}, 191);
    const tpl = resultOf<{ templates: Array<{ name: string; source: string }> }>(replies, 191);
    expect(Array.isArray(tpl.templates)).toBe(true);
    for (const t of tpl.templates) {
      expect(typeof t.name).toBe("string");
      // 只给来源标签，不外泄绝对路径
      expect(t.source).not.toContain("/");
      expect(t.source).not.toContain("\\");
    }

    await rpc("get_session_stats", {}, 192);
    expect(resultOf(replies, 192).stats).toBeDefined();
  });

  test("clear_messages：叶指针回根 + 通知事件 + cleared 回执", async () => {
    const { replies, events, sessions, sid, rpc } = await newSession({}, 200);
    const sm = sessions.get(sid)!.session.sessionManager;
    sm.appendMessage({ role: "user", content: "要被清空的上文", timestamp: Date.now() });
    const before = sm.getEntryCount();

    await rpc("clear_messages", {}, 201);
    expect(resultOf<{ status: string }>(replies, 201).status).toBe("cleared");
    expect(events.some((e) => e.event.type === "notice" && e.event.payload.source === "session")).toBe(true);
    // append-only：条目数量不变，只是 leaf 回根
    expect(sm.getEntryCount()).toBe(before);
  });

  test("get_messages：limit<=0 回空、limit 截取尾部、内容块与元数据原样带上", async () => {
    // 这条测的是 Maxma 的**投影**（引擎 messages → 契约形状），不测引擎自己怎么攒消息，
    // 所以直接给一个带 messages 的假会话，避免为了造两条消息去跑模型。
    const { io, replies } = fakeIo();
    const fakeSession = {
      ...makeFakeSession(),
      messages: [
        { role: "user", content: "第一句", timestamp: 1 },
        {
          role: "assistant",
          content: [{ type: "text", text: "第二" }, { type: "image" }, { type: "text", text: "句" }],
          usage: { input: 3, output: 5 },
          provider: "acme",
          model: "m-1",
          timestamp: 2,
        },
        { role: "tool", content: { raw: true } },
      ],
    };
    const sessions = new Map<string, PiSessionRecord>([["fake-sid", fakeRecord(fakeSession as never)]]);
    const pendingPlans = new Map();
    const rpc = (patch: Record<string, unknown>, id: number) =>
      handlePiSessionRpc({ io, sessions, pendingPlans }, "get_messages", "fake-sid", patch, id);

    await rpc({ limit: 0 }, 211);
    const empty = resultOf<{ messages: unknown[]; total: number }>(replies, 211);
    expect(empty.messages).toEqual([]);
    expect(empty.total).toBe(3);

    await rpc({ limit: 1 }, 212);
    const last = resultOf<{
      messages: Array<{ role: string; content: unknown; provider?: string; model?: string }>;
      total: number;
    }>(replies, 212);
    expect(last.messages.length).toBe(1);
    expect(last.messages[0]!.role).toBe("tool");
    // 非字符串/非文本块的内容一律规范化为空串（前端只认文本）
    expect(last.messages[0]!.content).toBe("");

    await rpc({ limit: 2 }, 213);
    const tail = resultOf<{
      messages: Array<{ role: string; content: string; provider?: string; model?: string; usage?: unknown }>;
      total: number;
    }>(replies, 213);
    expect(tail.messages.length).toBe(2);
    // 数组 content 只拼 text 块（image 块被跳过）
    expect(tail.messages[0]!.content).toBe("第二句");
    // 用量脚注依赖这几个字段，不许在历史里丢失
    expect(tail.messages[0]!.provider).toBe("acme");
    expect(tail.messages[0]!.model).toBe("m-1");
    expect(tail.messages[0]!.usage).toEqual({ input: 3, output: 5 });
  });

  test("cancel：拒绝全部在途审批与扩展对话框，并 abort 引擎", async () => {
    const { replies, sessions, sid, rpc } = await newSession({}, 220);
    const record = sessions.get(sid)!;
    await rpc("cancel", {}, 221);
    expect(resultOf<{ ok: boolean }>(replies, 221).ok).toBe(true);
    expect(record.approvalGate.pendingCount()).toBe(0);
  });

  test("get_health 报引擎名与在途审批数", async () => {
    const { replies, rpc } = await newSession({}, 230);
    await rpc("get_health", {}, 231);
    const health = resultOf<{ engine: string; streaming: boolean; pending_approvals: number }>(replies, 231);
    expect(health.engine).toBe("pi");
    expect(typeof health.streaming).toBe("boolean");
    expect(health.pending_approvals).toBe(0);
  });

  test("destroy_session 拆订阅、清 map；之后 RPC 找不到会话", async () => {
    const { replies, sessions, sid, rpc } = await newSession({}, 240);
    await rpc("destroy_session", {}, 241);
    expect(resultOf<{ ok: boolean }>(replies, 241).ok).toBe(true);
    expect(sessions.has(sid)).toBe(false);
  });
});
