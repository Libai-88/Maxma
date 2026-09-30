/**
 * tests/kernel-bridge.test.ts — pi 桥接层测试（阶段一 §6.2 任务 1/2/4）。
 *
 * 覆盖：事件映射（合成官方形状事件驱动）、审批门（emit/兑现/超时/拒绝）、
 * prompt 编排（正常/超时/异常）、create_session(pi) RPC 装配与分发。
 * 不发起模型调用。
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { mapPiAgentEventToMaxma } from "../src/kernel/events";
import { createMaxmaApprovalGate, needsApprovalForMode } from "../src/kernel/approval-gate";
import { createMaxmaBlockerExtension } from "../src/kernel/extensions/maxma-blocker";
import { loadMaxmaMcpEntries } from "../src/kernel/mcp";
import { resolvePiModel } from "../src/kernel/model";
import { buildPiCustomTools } from "../src/kernel/tools";
import { createMaxmaSession } from "../src/kernel/pi-session";
import { orchestratePiPrompt, handlePiCancelGuard } from "../src/kernel/prompt";
import {
  handlePiCreateSession,
  handlePiSessionRpc,
  type PiBridgeIo,
  type PiSessionRecord,
} from "../src/kernel/bridge-pi";

// ── 事件映射 ──────────────────────────────────────────────

describe("kernel: mapPiAgentEventToMaxma", () => {
  test("text_delta → token", () => {
    expect(
      mapPiAgentEventToMaxma({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "你好" },
      }),
    ).toEqual({ type: "token", payload: { token: "你好" } });
  });

  test("thinking 三段映射", () => {
    expect(
      mapPiAgentEventToMaxma({ type: "message_update", assistantMessageEvent: { type: "thinking_start" } }),
    ).toEqual({ type: "thinking_start", payload: {} });
    expect(
      mapPiAgentEventToMaxma({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "推" } }),
    ).toEqual({ type: "thinking_delta", payload: { delta: "推" } });
    expect(
      mapPiAgentEventToMaxma({ type: "message_update", assistantMessageEvent: { type: "thinking_end", content: "理" } }),
    ).toEqual({ type: "thinking_end", payload: { content: "理" } });
  });

  test("assistantMessageEvent.error → error（提取 content blocks 文本）", () => {
    const mapped = mapPiAgentEventToMaxma({
      type: "message_update",
      assistantMessageEvent: {
        type: "error",
        error: { content: [{ type: "text", text: "模型 429" }] },
      },
    });
    expect(mapped).toEqual({ type: "error", payload: { code: "AGENT_ERROR", message: "模型 429" } });
  });

  test("tool_execution_start/update/end → tool_start/tool_update/tool_end", () => {
    expect(
      mapPiAgentEventToMaxma({ type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: { path: "a.ts" } }),
    ).toEqual({ type: "tool_start", payload: { tool_name: "read", input: '{"path":"a.ts"}' } });

    expect(
      mapPiAgentEventToMaxma({ type: "tool_execution_update", toolCallId: "c1", toolName: "read", partialResult: "..." }),
    ).toEqual({ type: "tool_update", payload: { tool_name: "read", partial_result: "..." } });

    const end = mapPiAgentEventToMaxma({ type: "tool_execution_end", toolCallId: "c1", toolName: "read", result: "ok", isError: false });
    expect(end?.type).toBe("tool_end");
    expect((end!.payload as any).tool_name).toBe("read");
    expect((end!.payload as any).output).toBe('"ok"');

    const err = mapPiAgentEventToMaxma({ type: "tool_execution_end", toolCallId: "c2", toolName: "bash", result: { e: 1 }, isError: true });
    expect(err?.type).toBe("tool_error");
  });

  test("message_end → answer（text blocks 拼接）", () => {
    expect(
      mapPiAgentEventToMaxma({
        type: "message_end",
        message: { content: [{ type: "thinking", thinking: "x" }, { type: "text", text: "答案" }] },
      }),
    ).toEqual({ type: "answer", payload: { content: "答案" } });
  });

  test("done 由 agent_settled 触发且幂等；agent_end 不触发", () => {
    const guard = { done: false };
    expect(mapPiAgentEventToMaxma({ type: "agent_end", messages: [] }, guard)).toBeNull();
    expect(guard.done).toBe(false);
    expect(mapPiAgentEventToMaxma({ type: "agent_settled" }, guard)).toEqual({ type: "done", payload: {} });
    expect(guard.done).toBe(true);
    // DONE-DUP-001：已 done 后不再重复
    expect(mapPiAgentEventToMaxma({ type: "agent_settled" }, guard)).toBeNull();
  });

  test("压缩与重试映射（官方字段名）", () => {
    expect(
      mapPiAgentEventToMaxma({ type: "compaction_start", reason: "overflow" }),
    ).toEqual({ type: "context_compressing", payload: { reason: "overflow", action: "context-full" } });

    const compressed = mapPiAgentEventToMaxma({
      type: "compaction_end",
      reason: "overflow",
      result: { summary: "摘要", firstKeptEntryId: "e1", tokensBefore: 9000 },
      aborted: false,
      willRetry: true,
      errorMessage: undefined,
    });
    expect(compressed?.type).toBe("context_compressed");
    expect((compressed!.payload as any).summary_preview).toBe("摘要");
    expect((compressed!.payload as any).before_tokens).toBe(9000);
    expect((compressed!.payload as any).will_retry).toBe(true);

    expect(
      mapPiAgentEventToMaxma({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 500, errorMessage: "429" }),
    ).toEqual({ type: "retry_start", payload: { attempt: 1, max_attempts: 3, delay_ms: 500, error_message: "429" } });
  });

  test("未知/无 Maxma 等价事件 → null", () => {
    expect(mapPiAgentEventToMaxma({ type: "queue_update", steering: [], followUp: [] })).toBeNull();
    expect(mapPiAgentEventToMaxma({ type: "turn_start" })).toBeNull();
    expect(mapPiAgentEventToMaxma({})).toBeNull();
  });
});

// ── 审批门 ────────────────────────────────────────────────

describe("kernel: approval gate", () => {
  test("needsApprovalForMode 权限矩阵", () => {
    const ann = { readOnlyHint: true };
    const annWrite = { readOnlyHint: false, destructiveHint: true };
    expect(needsApprovalForMode("auto", "bash", undefined)).toBe(false);
    expect(needsApprovalForMode("read_only", "read", ann)).toBe(false);
    expect(needsApprovalForMode("read_only", "write", annWrite)).toBe(true);
    expect(needsApprovalForMode("ask", "read", ann)).toBe(false);
    expect(needsApprovalForMode("ask", "write", annWrite)).toBe(true);
    // operate：读+写放行，bash / 破坏性工具需审批
    expect(needsApprovalForMode("operate", "read", ann)).toBe(false);
    expect(needsApprovalForMode("operate", "edit", { readOnlyHint: false })).toBe(false);
    expect(needsApprovalForMode("operate", "bash", undefined)).toBe(true);
    expect(needsApprovalForMode("operate", "write", annWrite)).toBe(true);
  });

  test("decide 发 ask_user 且 user_response 兑现", async () => {
    const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const gate = createMaxmaApprovalGate({
      emit: (e) => emitted.push(e),
      mode: () => "ask",
      timeoutMs: 60_000,
    });

    const pending = gate.decide({
      toolName: "bash",
      toolCallId: "t1",
      input: { command: "rm -rf /" },
      annotations: { readOnlyHint: false, destructiveHint: true },
    });
    // 异步 emit 在 decide 同步注册后微任务内完成
    await Promise.resolve();
    expect(emitted).toHaveLength(1);
    const ask = emitted[0]!;
    expect(ask.type).toBe("ask_user");
    expect(ask.payload.tool_name).toBe("bash");
    expect(ask.payload.mode).toBe("approval");
    expect(ask.payload.options).toEqual(["Approve", "Deny"]);
    expect(ask.payload.risk_level).toBe("high");
    const interactionId = ask.payload.interaction_id as string;

    expect(gate.resolveUserApproval(interactionId, "yes")).toBe(true);
    const decision = await pending;
    expect(decision.approved).toBe(true);
  });

  test("拒绝与超时默认拒绝", async () => {
    const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const gate = createMaxmaApprovalGate({
      emit: (e) => emitted.push(e),
      mode: () => "operate",
      timeoutMs: 30,
    });

    const denied = gate.decide({ toolName: "edit", toolCallId: "t2", input: {}, annotations: {} });
    await Promise.resolve();
    gate.resolveUserApproval((emitted[0]!.payload.interaction_id as string), "no");
    expect((await denied).approved).toBe(false);

    const timedOut = gate.decide({ toolName: "bash", toolCallId: "t3", input: {}, annotations: {} });
    const result = await timedOut;
    expect(result.approved).toBe(false);
    expect(gate.pendingCount()).toBe(0);
  });
});

// ── prompt 编排 ───────────────────────────────────────────

describe("kernel: orchestratePiPrompt", () => {
  test("正常完成 → done 且 guard 置位", async () => {
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const guard = { done: false };
    const session = { prompt: async () => {}, abort: async () => {} };
    await orchestratePiPrompt(session, "hi", guard, (e) => events.push(e), 1000);
    expect(guard.done).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
  });

  test("prompt 抛错 → PROMPT_ERROR + done", async () => {
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const guard = { done: false };
    const session = { prompt: async () => { throw new Error("boom"); }, abort: async () => {} };
    await orchestratePiPrompt(session, "hi", guard, (e) => events.push(e), 1000);
    expect(events.some((e) => e.type === "error" && (e.payload as any).code === "PROMPT_ERROR")).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
  });

  test("超时 → PROMPT_TIMEOUT + done + abort 被调用", async () => {
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const guard = { done: false };
    let aborted = false;
    // 模拟真实 abort 传播：abort 被调用后 prompt settle（否则悬挂 promise
    // 会让 bun test 进程无法退出）
    let failPrompt: ((err: Error) => void) | undefined;
    const session = {
      prompt: () => new Promise<void>((_res, rej) => {
        failPrompt = rej;
      }),
      abort: async () => {
        aborted = true;
        failPrompt?.(new Error("aborted"));
      },
    };
    await orchestratePiPrompt(session, "hi", guard, (e) => events.push(e), 30);
    expect(events.some((e) => e.type === "error" && (e.payload as any).code === "PROMPT_TIMEOUT")).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
    expect(aborted).toBe(true);
  });

  test("handlePiCancelGuard 幂等", () => {
    const events: Array<{ type: string }> = [];
    const guard = { done: false };
    handlePiCancelGuard(guard, (e) => events.push(e));
    handlePiCancelGuard(guard, (e) => events.push(e));
    expect(events).toHaveLength(1);
  });
});

// ── MaxmaBlocker 扩展（官方 tool_call 钩子） ──────────────

describe("kernel: maxma-blocker extension", () => {
  test("命中拒止锚 → block；未命中 → undefined", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-blocker-"));
    const sub = path.join(dir, "sub");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(dir, ".maxma_blocker"), "");

    let handler: ((event: unknown) => Promise<unknown>) | undefined;
    const fakePi = {
      on: (event: string, h: (e: unknown) => Promise<unknown>) => {
        if (event === "tool_call") handler = h;
        return () => {};
      },
    };
    const ext = createMaxmaBlockerExtension() as { factory: (pi: unknown) => void };
    ext.factory(fakePi);
    expect(handler).toBeDefined();

    // 命中：cwd 指向受保护子目录（父目录遍历找到标记）
    const blocked = (await handler!({
      type: "tool_call",
      toolName: "bash",
      toolCallId: "b1",
      input: { command: "ls", cwd: sub },
    })) as { block?: boolean; reason?: string };
    expect(blocked?.block).toBe(true);
    // reason 携带标记所在目录与被拦调用路径
    expect(blocked.reason).toContain(dir);
    expect(blocked.reason).toContain(sub);

    // 未命中：临时目录外部路径
    const outside = path.join(os.tmpdir(), "maxma-nonblock-check");
    fs.mkdirSync(outside, { recursive: true });
    const pass = await handler!({
      type: "tool_call",
      toolName: "read",
      toolCallId: "b2",
      input: { file_path: path.join(outside, "x.txt") },
    });
    expect(pass).toBeUndefined();

    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

// ── MCP 适配（mcp_servers.yaml → 官方 McpServerEntry） ────

describe("kernel: mcp adapter", () => {
  test("stdio 直映 + sse 降级 unsupported + allow/block → exposure/toolExposure", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-mcp-"));
    const yaml = [
      "mcp_servers:",
      "  - server_id: fs1",
      "    transport: stdio",
      "    command: node",
      "    args: [server.js]",
      "    allowed_tools: [read_file, list_dir]",
      "  - server_id: web1",
      "    transport: streamable_http",
      "    url: https://example.com/mcp",
      "    blocked_tools: [dangerous_tool]",
      "  - server_id: legacy",
      "    transport: sse",
      "    url: https://example.com/sse",
      "  - server_id: off",
      "    transport: stdio",
      "    command: nope",
      "    enabled: false",
    ].join("\n");
    const configPath = path.join(dir, "api", "data", "mcp_servers.yaml");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, yaml);

    const prevRoot = process.env.MAXMA_PROJECT_ROOT;
    process.env.MAXMA_PROJECT_ROOT = dir;
    try {
      const result = loadMaxmaMcpEntries();
      expect(result).toBeDefined();
      const byName = Object.fromEntries(result!.entries.map((e) => [e.name, e]));

      // stdio + allow 白名单 → server exposure hidden + 白名单 direct
      const fs1 = byName.fs1!;
      expect((fs1.config as any).command).toBe("node");
      expect(fs1.config.exposure).toBe("hidden");
      expect(fs1.config.toolExposure).toEqual({ read_file: "direct", list_dir: "direct" });

      // http + block → toolExposure hidden
      const web1 = byName.web1!;
      expect(web1.config.type).toBe("http");
      expect(web1.config.toolExposure).toEqual({ dangerous_tool: "hidden" });

      // sse → unsupported；enabled:false → 不入列
      expect(result!.unsupported.legacy).toContain("sse");
      expect(byName.off).toBeUndefined();
    } finally {
      if (prevRoot === undefined) delete process.env.MAXMA_PROJECT_ROOT;
      else process.env.MAXMA_PROJECT_ROOT = prevRoot;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── 模型解析与凭据注入（官方 ModelRuntime） ───────────────

describe("kernel: resolvePiModel", () => {
  test("registry 命中：内建目录模型直取", async () => {
    const { model } = await resolvePiModel({ model: "openai/gpt-4o" });
    expect(model.provider).toBe("openai");
    expect(model.id).toBe("gpt-4o");
    expect(model.baseUrl).toBeTruthy();
  });

  test("registry 未命中 + baseUrl → registerProvider 注册自定义 provider", async () => {
    const { model } = await resolvePiModel({
      model: "maxma-custom/my-model",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      providerType: "openai-completions",
      contextWindow: 64_000,
      maxTokens: 4_096,
    });
    expect(model.provider).toBe("maxma-custom");
    expect(model.id).toBe("my-model");
    expect(model.baseUrl).toBe("https://api.example.com/v1");
    expect(model.contextWindow).toBe(64_000);
    expect(model.maxTokens).toBe(4_096);
  });

  test("registry 未命中且无 baseUrl → 明确报错（不臆造模型元数据）", async () => {
    let message = "";
    try {
      await resolvePiModel({ model: "no-such-provider/no-such-model" });
    } catch (err) {
      message = String((err as Error).message);
    }
    expect(message).toContain("not found in pi registry");
  });
});

// ── create_session(pi) RPC 装配 ───────────────────────────

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

describe("kernel: pi RPC bridge", () => {
  test("create_session(engine=pi) 装配会话并登记", async () => {
    const { io, replies, errors } = fakeIo();
    const sessions = new Map<string, PiSessionRecord>();
    const pendingPlans = new Map();
    await handlePiCreateSession({ io, sessions }, { cwd: import.meta.dir, permission_mode: "read_only", in_memory: true }, 1);

    expect(errors.length).toBe(0);
    const sid = (replies[0]!.result as { session_id: string }).session_id;
    expect(sessions.has(sid)).toBe(true);
    expect(sessions.get(sid)!.permissionMode).toBe("read_only");
  });

  test("pi 会话支持核心 RPC，未迁移方法显式报错", async () => {
    const { io, replies, errors } = fakeIo();
    const sessions = new Map<string, PiSessionRecord>();
    const pendingPlans = new Map();
    await handlePiCreateSession({ io, sessions }, { cwd: import.meta.dir, in_memory: true }, 1);
    const sid = (replies[0]!.result as { session_id: string }).session_id;

    // get_health
    await handlePiSessionRpc({ io, sessions, pendingPlans }, "get_health", sid, {}, 2);
    const health = replies.find((r) => r.id === 2)!.result as Record<string, unknown>;
    expect(health.engine).toBe("pi");

    // 未迁移方法 → 显式错误（不允许黑洞）
    await handlePiSessionRpc({ io, sessions, pendingPlans }, "list_plugins", sid, {}, 3);
    expect(errors.some((e) => e.id === 3 && e.message.includes("not yet migrated"))).toBe(true);

    // destroy
    await handlePiSessionRpc({ io, sessions, pendingPlans }, "destroy_session", sid, {}, 4);
    expect(sessions.has(sid)).toBe(false);
  });

  test("Maxma 自定义工具经官方 defineTool 注册且可执行", async () => {
    // 临时记忆目录（search_memories 读 MAXMA_PROJECT_ROOT/config/personas/memory.yaml）
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-tools-"));
    const memoryDir = path.join(dir, "config", "personas");
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(memoryDir, "memory.yaml"),
      ["mem001:", "  description: 用户偏好深色主题", "  theme: 偏好", "  latest_update_time: \"2026-09-30 10:00:00\""].join("\n"),
    );
    const prevRoot = process.env.MAXMA_PROJECT_ROOT;
    process.env.MAXMA_PROJECT_ROOT = dir;
    try {
      // bridge 层（handlePiCreateSession）注入 customTools: buildPiCustomTools()；
      // 此处直接等价传入以验证 kernel 装配
      const session = await createMaxmaSession({ inMemory: true, cwd: import.meta.dir, customTools: buildPiCustomTools() });
      const names = session.getActiveToolNames();
      for (const t of ["remember_memory", "search_memories", "get_sticker", "list_rules"]) {
        expect(names).toContain(t);
      }
      session.dispose();
    } finally {
      if (prevRoot === undefined) delete process.env.MAXMA_PROJECT_ROOT;
      else process.env.MAXMA_PROJECT_ROOT = prevRoot;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("checkpoint save/restore：官方 label + branch 语义", async () => {
    const { io, replies, errors } = fakeIo();
    const sessions = new Map<string, PiSessionRecord>();
    const pendingPlans = new Map();
    await handlePiCreateSession({ io, sessions }, { cwd: import.meta.dir, in_memory: true }, 30);
    const sid = (replies[0]!.result as { session_id: string }).session_id;
    const record = sessions.get(sid)!;
    const sm = record.session.sessionManager;

    // 造一条用户消息条目作为叶子（官方 appendMessage）
    sm.appendMessage({ role: "user", content: "第一条消息", timestamp: Date.now() });
    const leafBefore = sm.getLeafId()!;

    await handlePiSessionRpc({ io, sessions, pendingPlans }, "checkpoint_action", sid, { action: "save", goal: "重构前" }, 31);
    const saved = replies.find((r) => r.id === 31)!.result as Record<string, unknown>;
    expect(saved.action).toBe("save");
    expect(saved.entry_id).toBe(leafBefore);
    expect(sm.getLabel(leafBefore)).toBe("重构前");

    // 追加新消息后再 restore → 叶指针回到检查点条目
    sm.appendMessage({ role: "user", content: "第二条消息", timestamp: Date.now() });
    expect(sm.getLeafId()).not.toBe(leafBefore);

    await handlePiSessionRpc({ io, sessions, pendingPlans }, "checkpoint_action", sid, { action: "restore" }, 32);
    const restored = replies.find((r) => r.id === 32)!.result as Record<string, unknown>;
    expect(restored.restored).toBe(true);
    expect(restored.entry_id).toBe(leafBefore);
    expect(sm.getLeafId()).toBe(leafBefore);
    expect(errors.some((e) => e.id === 32)).toBe(false);
  });

  test("Plan 模式：set_plan_mode 置位 + plan_action 兑现", async () => {
    const { io, replies } = fakeIo();
    const sessions = new Map<string, PiSessionRecord>();
    const pendingPlans = new Map();
    await handlePiCreateSession({ io, sessions, pendingPlans }, { cwd: import.meta.dir, in_memory: true }, 40);
    const sid = (replies[0]!.result as { session_id: string }).session_id;

    await handlePiSessionRpc({ io, sessions, pendingPlans }, "set_plan_mode", sid, { enabled: true }, 41);
    expect(sessions.get(sid)!.planMode).toBe(true);

    // plan_action 未命中（无在途审批）→ matched:false，不抛错
    await handlePiSessionRpc({ io, sessions, pendingPlans }, "plan_action", sid, { plan_id: "nope", action: "approve" }, 42);
    const pa = replies.find((r) => r.id === 42)!.result as Record<string, unknown>;
    expect(pa.matched).toBe(false);

    await handlePiSessionRpc({ io, sessions, pendingPlans }, "set_plan_mode", sid, { enabled: false }, 43);
    expect(sessions.get(sid)!.planMode).toBe(false);
  });

  test("submit_plan 工具：plan_proposed → 兑现 → plan_completed（官方工具结果）", async () => {
    const { createSubmitPlanTool, resolvePiPlanAction, parsePlanSteps } = await import("../src/kernel/plan");
    const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const pendingPlans = new Map();
    let planMode = true;
    const tool = createSubmitPlanTool({
      sessionId: "s-test",
      isPlanMode: () => planMode,
      onApproved: () => {
        planMode = false;
      },
      emit: (e) => emitted.push(e),
      pendingPlans,
      timeoutMs: 60_000,
    }) as { execute: (id: string, params: unknown) => Promise<{ content: Array<{ text?: string }>; details: unknown }> };

    const steps = parsePlanSteps("# 计划\n- 第一步\n- 第二步\n1. 第三步");
    expect(steps).toEqual(["第一步", "第二步", "第三步"]);

    const execution = tool.execute("call-1", { plan_markdown: "# 计划\n- 第一步\n- 第二步" });
    await new Promise((r) => setTimeout(r, 10)); // 等待 plan_proposed 发出
    const proposed = emitted.find((e) => e.type === "plan_proposed")!;
    expect(proposed).toBeDefined();
    const planId = proposed.payload.plan_id as string;
    expect(proposed.payload.steps).toEqual(["第一步", "第二步"]);

    const matched = resolvePiPlanAction(pendingPlans, planId, { action: "approve" });
    expect(matched).toBe(true);
    const result = await execution;
    expect((result.content[0]!.text ?? "").startsWith("[Plan Approved]")).toBe(true);
    expect(emitted.some((e) => e.type === "plan_completed")).toBe(true);

    // 拒绝路径：重新进入计划模式后提交，拒绝则留在计划模式
    planMode = true;
    const execution2 = tool.execute("call-2", { plan_markdown: "- 修订计划" });
    await new Promise((r) => setTimeout(r, 10));
    const planId2 = (emitted.filter((e) => e.type === "plan_proposed").at(-1)!.payload.plan_id) as string;
    resolvePiPlanAction(pendingPlans, planId2, { action: "reject", reason: "需要修改" });
    const result2 = await execution2;
    expect((result2.content[0]!.text ?? "").startsWith("Plan rejected")).toBe(true);
  });

  test("Goal 模式：状态机 + goal_updated 事件 + get_goal_state", async () => {
    const { io, replies, errors, events } = fakeIo();
    const sessions = new Map<string, PiSessionRecord>();
    const pendingPlans = new Map();
    await handlePiCreateSession({ io, sessions, pendingPlans }, { cwd: import.meta.dir, in_memory: true }, 50);
    const sid = (replies[0]!.result as { session_id: string }).session_id;

    // set：状态置位 + goal_updated 事件
    await handlePiSessionRpc({ io, sessions, pendingPlans }, "goal_action", sid, { action: "set", objective: "完成周报" }, 51);
    expect(errors.some((e) => e.id === 51)).toBe(false);
    const setResult = replies.find((r) => r.id === 51)!.result as Record<string, unknown>;
    const goal = (setResult.state as { goal: { id: string; objective: string; status: string } }).goal;
    expect(goal.objective).toBe("完成周报");
    expect(goal.status).toBe("active");
    const updated = events.filter((e) => e.event.type === "goal_updated");
    expect(updated.length).toBe(1);

    // pause → status paused + mode paused
    await handlePiSessionRpc({ io, sessions, pendingPlans }, "goal_action", sid, { action: "pause" }, 52);
    const pausedState = sessions.get(sid)!.goalState;
    expect(pausedState.goal?.status).toBe("paused");
    expect(pausedState.mode).toBe("paused");

    // drop → 空状态；get_goal_state 返回 null
    await handlePiSessionRpc({ io, sessions, pendingPlans }, "goal_action", sid, { action: "drop" }, 53);
    await handlePiSessionRpc({ io, sessions, pendingPlans }, "get_goal_state", sid, {}, 54);
    const stateRes = replies.find((r) => r.id === 54)!.result as Record<string, unknown>;
    expect(stateRes.state).toBeNull();

    // set 缺 objective → 显式报错
    await handlePiSessionRpc({ io, sessions, pendingPlans }, "goal_action", sid, { action: "set" }, 55);
    expect(errors.some((e) => e.id === 55 && e.message.includes("objective is required"))).toBe(true);
  });

  test("session_recap 静默旁路 + execute_workflow_step 契约", async () => {
    const { io, replies, errors, events } = fakeIo();
    const sessions = new Map<string, PiSessionRecord>();
    const pendingPlans = new Map();
    await handlePiCreateSession({ io, sessions, pendingPlans }, { cwd: import.meta.dir, in_memory: true }, 60);
    const sid = (replies[0]!.result as { session_id: string }).session_id;

    // session_recap：空会话回顾（无模型调用，getLastAssistantText 为空）→ 空 recap
    await handlePiSessionRpc({ io, sessions, pendingPlans }, "session_recap", sid, {}, 61);
    const recap = replies.find((r) => r.id === 61)!.result as Record<string, unknown>;
    expect(recap.recap).toBe("");
    // RECAP-SILENT-001：回顾期间的 prompt 事件不应泄漏（无 done 事件）
    expect(events.some((e) => e.event.type === "done")).toBe(false);

    // execute_workflow_step：契约事件 workflow_step_start/end（prompt 会失败于
    // 无模型，但 start 事件先发、error 路径发 workflow_step_error）
    await handlePiSessionRpc(
      { io, sessions, pendingPlans },
      "execute_workflow_step",
      sid,
      { step_definition: { step_id: "s1", tool: "read", args: { file_path: "x" } } },
      62,
    );
    expect(events.some((e) => e.event.type === "workflow_step_start")).toBe(true);
    // 无模型环境：prompt 失败 → error 路径（或正常路径），但必有起或错事件且 RPC 不挂起
    expect(replies.some((r) => r.id === 62) || errors.some((e) => e.id === 62)).toBe(true);
    expect(sessions.has(sid)).toBe(true);
  });

  test("get_messages / compact / settings / undo 契约形状", async () => {
    const { io, replies, errors } = fakeIo();
    const pendingPlans = new Map();
    const sessions = new Map<string, PiSessionRecord>();
    await handlePiCreateSession({ io, sessions }, { cwd: import.meta.dir, in_memory: true }, 20);
    const sid = (replies[0]!.result as { session_id: string }).session_id;

    // get_messages（空会话）
    await handlePiSessionRpc({ io, sessions, pendingPlans }, "get_messages", sid, { limit: 10 }, 21);
    const gm = replies.find((r) => r.id === 21)!.result as Record<string, unknown>;
    expect(Array.isArray(gm.messages)).toBe(true);
    expect(gm.total).toBe(0);

    // set_settings 写入 → get_settings 读回；未知键静默跳过
    await handlePiSessionRpc({ io, sessions, pendingPlans }, "set_settings", sid, { path: "compaction.enabled", value: false }, 22);
    await handlePiSessionRpc({ io, sessions, pendingPlans }, "get_settings", sid, { paths: ["compaction.enabled", "no.such.key"] }, 23);
    const after = replies.find((r) => r.id === 23)!.result as { settings: Record<string, unknown> };
    expect(after.settings["compaction.enabled"]).toBe(false);
    expect("no.such.key" in after.settings).toBe(false);
    expect(errors.some((e) => e.id === 22)).toBe(false);

    // undo：空会话无轮次 → removed 0 / turns_removed 0（不抛错）
    await handlePiSessionRpc({ io, sessions, pendingPlans }, "undo", sid, { steps: 1 }, 25);
    const undo = replies.find((r) => r.id === 25)!.result as Record<string, unknown>;
    expect(undo.turns_removed).toBe(0);
    expect(undo.removed).toBe(0);
  });

  test("set_auto_approve 运行时切换权限模式", async () => {
    const { io, replies } = fakeIo();
    const pendingPlans = new Map();
    const sessions = new Map<string, PiSessionRecord>();
    await handlePiCreateSession({ io, sessions }, { cwd: import.meta.dir, in_memory: true }, 10);
    const sid = (replies[0]!.result as { session_id: string }).session_id;
    const record = sessions.get(sid)!;
    expect(record.permissionMode).toBe("ask");

    await handlePiSessionRpc({ io, sessions, pendingPlans }, "set_auto_approve", sid, { auto_approve: true }, 11);
    expect(record.permissionMode).toBe("auto");
    // gate 的 mode 闭包读 record —— 切换即时生效
    expect(record.approvalGate.needsApproval({ toolName: "bash" })).toBe(false);

    await handlePiSessionRpc({ io, sessions, pendingPlans }, "set_auto_approve", sid, { auto_approve: false }, 12);
    expect(record.permissionMode).toBe("ask");
    expect(record.approvalGate.needsApproval({ toolName: "bash" })).toBe(true);
  });
});
