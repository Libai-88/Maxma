/**
 * tests/contract-snapshot.test.ts — 契约快照（阶段〇-4，切默认引擎前的保险）。
 *
 * 把 pi 引擎对外形状固化为 golden snapshot：
 *   1. pi 事件 → Maxma WS 事件映射（docs/contracts/ws-events.md §3.1 词表逐条）
 *   2. pi RPC 回复形状（docs/contracts/agent-rpc.md §8）
 *   3. ask_user 审批 payload
 * 任何映射/形状变更都会显式 diff；更新快照必须同步核对契约文档（bun test -u）。
 * 不发起模型调用。
 */

import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { mapPiAgentEventToMaxma } from "../src/kernel/events";
import { createMaxmaApprovalGate } from "../src/kernel/approval-gate";
import {
  handlePiCreateSession,
  handlePiSessionRpc,
  type PiBridgeIo,
  type PiSessionRecord,
} from "../src/kernel/bridge-pi";

// ── 1. 事件映射快照（合成官方形状 pi 事件） ────────────────

function snapMapping(event: unknown): Record<string, unknown> | null {
  return mapPiAgentEventToMaxma(event, { done: false });
}

describe("contract snapshot: pi event mapping (ws-events.md §3.1)", () => {
  test("流式输出族", () => {
    expect(
      snapMapping({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "A" } }),
    ).toMatchSnapshot("token");
    expect(
      snapMapping({ type: "message_update", assistantMessageEvent: { type: "thinking_start" } }),
    ).toMatchSnapshot("thinking_start");
    expect(
      snapMapping({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "x" } }),
    ).toMatchSnapshot("thinking_delta");
    expect(
      snapMapping({ type: "message_update", assistantMessageEvent: { type: "thinking_end", content: "x" } }),
    ).toMatchSnapshot("thinking_end");
    expect(
      snapMapping({
        type: "message_update",
        assistantMessageEvent: { type: "error", error: { content: [{ type: "text", text: "boom" }] } },
      }),
    ).toMatchSnapshot("error");
  });

  test("工具执行族", () => {
    expect(
      snapMapping({ type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: { file_path: "a" } }),
    ).toMatchSnapshot("tool_start");
    expect(
      snapMapping({ type: "tool_execution_update", toolCallId: "c1", toolName: "bash", partialResult: "50%" }),
    ).toMatchSnapshot("tool_update");
    expect(
      snapMapping({ type: "tool_execution_end", toolCallId: "c1", toolName: "bash", result: "ok", isError: false }),
    ).toMatchSnapshot("tool_end");
    expect(
      snapMapping({ type: "tool_execution_end", toolCallId: "c2", toolName: "bash", result: { e: "x" }, isError: true }),
    ).toMatchSnapshot("tool_error");
  });

  test("回答与终态族", () => {
    expect(
      snapMapping({
        type: "message_end",
        message: { content: [{ type: "text", text: "答案正文" }] },
      }),
    ).toMatchSnapshot("answer");
    // done 由 agent_settled 触发（官方终态语义）
    expect(snapMapping({ type: "agent_settled" })).toMatchSnapshot("done");
    // agent_end 不发 done（重试/排队后可能继续）
    expect(snapMapping({ type: "agent_end", messages: [] })).toMatchSnapshot("agent_end_null");
  });

  test("压缩与重试族", () => {
    expect(snapMapping({ type: "compaction_start", reason: "threshold" })).toMatchSnapshot("context_compressing");
    expect(
      snapMapping({
        type: "compaction_end",
        reason: "overflow",
        result: { summary: "s", firstKeptEntryId: "e", tokensBefore: 123 },
        aborted: false,
        willRetry: false,
      }),
    ).toMatchSnapshot("context_compressed");
    expect(
      snapMapping({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 800, errorMessage: "429" }),
    ).toMatchSnapshot("retry_start");
    expect(snapMapping({ type: "auto_retry_end", success: true, attempt: 1 })).toMatchSnapshot("retry_end");
  });
});

// ── 2. RPC 回复形状快照 ──────────────────────────────────

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

/** 快照只对形状负责：掩码每次运行变化的随机标识。 */
// session_id 契约为 uuid4().hex（32 位无连字符）；同时保留带连字符 UUID 形态的掩码。
const UUID_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i;
function maskRandomIds<T>(value: T): T {
  if (typeof value === "string" && UUID_RE.test(value)) return "<uuid>" as unknown as T;
  if (Array.isArray(value)) return value.map(maskRandomIds) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = maskRandomIds(v);
    return out as T;
  }
  return value;
}

describe("contract snapshot: pi RPC shapes (agent-rpc.md §8)", () => {
  test("create_session / get_health / undo / get_messages / get_goal_state", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-snap-"));
    const memoryDir = path.join(dir, "config", "personas");
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(path.join(memoryDir, "memory.yaml"), "m1:\n  description: d\n");

    const prevRoot = process.env.MAXMA_PROJECT_ROOT;
    process.env.MAXMA_PROJECT_ROOT = dir;
    const { io, replies, errors } = fakeIo();
    const sessions = new Map<string, PiSessionRecord>();
    const pendingPlans = new Map();
    try {
      await handlePiCreateSession(
        { io, sessions, pendingPlans },
        { cwd: import.meta.dir, in_memory: true, permission_mode: "read_only" },
        1,
      );
      expect(maskRandomIds(replies[0])).toMatchSnapshot("create_session_reply");
      const sid = (replies[0]!.result as { session_id: string }).session_id;

      await handlePiSessionRpc({ io, sessions, pendingPlans }, "get_health", sid, {}, 2);
      expect(replies.find((r) => r.id === 2)).toMatchSnapshot("get_health_reply");

      await handlePiSessionRpc({ io, sessions, pendingPlans }, "undo", sid, { steps: 1 }, 3);
      expect(replies.find((r) => r.id === 3)).toMatchSnapshot("undo_reply");

      await handlePiSessionRpc({ io, sessions, pendingPlans }, "get_messages", sid, { limit: 5 }, 4);
      expect(replies.find((r) => r.id === 4)).toMatchSnapshot("get_messages_reply");

      await handlePiSessionRpc({ io, sessions, pendingPlans }, "get_goal_state", sid, {}, 5);
      expect(replies.find((r) => r.id === 5)).toMatchSnapshot("get_goal_state_reply");

      await handlePiSessionRpc({ io, sessions, pendingPlans }, "set_plan_mode", sid, { enabled: true }, 6);
      expect(replies.find((r) => r.id === 6)).toMatchSnapshot("set_plan_mode_reply");

      // 未迁移方法：显式错误形状（不允许黑洞）
      await handlePiSessionRpc({ io, sessions, pendingPlans }, "list_plugins", sid, {}, 7);
      expect(errors.find((e) => e.id === 7)).toMatchSnapshot("unsupported_error");

      expect(errors.filter((e) => e.id !== 7).length).toBe(0);
    } finally {
      if (prevRoot === undefined) delete process.env.MAXMA_PROJECT_ROOT;
      else process.env.MAXMA_PROJECT_ROOT = prevRoot;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── 3. ask_user 审批 payload 快照 ────────────────────────

describe("contract snapshot: ask_user payload (ws-events.md §3.2)", () => {
  test("destructive 工具审批请求", async () => {
    const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const gate = createMaxmaApprovalGate({
      emit: (e) => emitted.push(e),
      mode: () => "ask",
      timeoutMs: 60_000,
    });
    const pending = gate.decide({
      toolName: "bash",
      toolCallId: "t-snap",
      input: { command: "npm test" },
      annotations: { readOnlyHint: false, destructiveHint: false },
    });
    await Promise.resolve();
    const ask = emitted[0]!;
    expect(maskRandomIds(ask.payload)).toMatchSnapshot("ask_user_payload");

    gate.resolveUserApproval(ask.payload.interaction_id as string, "yes");
    const decision = await pending;
    expect(decision).toMatchSnapshot("approval_decision_approved");
  });
});
