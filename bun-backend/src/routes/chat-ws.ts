/**
 * routes/chat-ws.ts — 对话 WebSocket 层（api/routes/chat.py websocket_chat +
 * _stream_turn_sidecar + _handle_turn_result 的 Bun 直译，阶段二 2.3a/2.3b）。
 *
 * 架构：Bun.serve websocket handler（upgrade 鉴权在 server.ts，X-Maxma-Token
 * 或 WS subprotocol）+ kernel in-process 直调。事件流：kernel io.sendEvent →
 * onKernelEvent（回合富化）→ wsRegistry 广播（session → Set<ServerWebSocket>，
 * MULTI-WS-001 多窗口同播）。
 *
 * 契约保留（api/ws_protocol.py + docs/contracts/ws-events.md）：
 *   - server 首帧 hello {protocol_version:1}
 *   - client 消息白名单（ping/chat/cancel/user_response/plan_response/
 *     update_auto_approve/set_plan_mode/checkpoint_action/goal_action/
 *     artifact_action），未知类型静默丢弃
 *   - IDEMPOTENCY-001 client_msg_id 幂等去重（turn 成功后登记）
 *   - CONN-MUTEX-001 同会话单连接持有 turn（其他连接发 chat → BUSY error）
 *   - AG-CONTEXT-001 断开不销毁会话（重连复用）
 *   - role/事件形状逐字段对齐（kernel mapPiAgentEventToMaxma 已产出 Maxma 事件）
 *
 * 2.3b 回合富化层（kernel 事件统一出口 onKernelEvent）：
 *   - TURN-OWNERSHIP-001：token / tool 系列 / error / answer / done 携带本轮
 *     turn_id（每轮生成一次；前端据此丢弃已终结轮次的迟到事件）
 *   - answer/done 由 kernel 吞流、done 到达时重合成（done 附 context_usage+empty）
 *   - PERF-TOOL-OUTPUT-001：tool_end 输出 >100KB / tool_error >20KB 截断
 *   - Phase 2.2 artifact 合成（写类工具输出 → InteractiveArtifact 事件）
 *   - MEMORY-EVENTS-001：remember_memory 工具活动收集，done 后合成 memory_* 事件流
 *   - AG-SUBAGENT-001：deferred_subagent_submitted 写入 DeferredRunManager
 *   - METRICS-WIRE-001：工具/LLM 调用指标接线
 *   - 活动埋点（turn_start / turn_end / turn_cancelled / turn_error / tool 事件）
 *   - WS per-session 限流（capacity 60/60s，错误形状对齐 make_error RATE_LIMITED）
 *   - AG-IDEMPOTENCY-001：cancel 后已产出回复补发 answer(partial)+登记幂等 id
 */

import type { ServerWebSocket } from "bun";
import * as crypto from "node:crypto";

import type { PiPendingPlan, PiSessionRecord } from "../../../bun-sidecar/src/kernel/bridge-pi";
import { resolvePiModel } from "../../../bun-sidecar/src/kernel/model";
import { createTaskBrief, type TaskBriefResult } from "../plugins/task-brief";

import { record as recordActivity } from "../activity-hub";
import { decryptProviderKey, findProvider, loadProviders } from "./providers";
import { getMetrics } from "../metrics";
import { getErrorCollector } from "../error-collector";
import { getDeferredRunManager } from "./deferred-runs";
import { newTurnId, calculateContextUsage } from "./chat-turns";
import { FILE_WRITING_TOOLS, extractFilePathFromOutput, buildArtifactPayload } from "./chat-artifacts";

/** client → server 消息类型白名单（api/ws_protocol.py WsMessageType）。 */
export const CLIENT_MESSAGE_TYPES = new Set([
  "ping",
  "chat",
  "cancel",
  "user_response",
  "plan_response",
  "update_auto_approve",
  "set_plan_mode",
  "checkpoint_action",
  "goal_action",
  "artifact_action",
  "task_brief_answer",
  "task_brief_execute",
  "task_brief_cancel",
]);

/** PERF-TOOL-OUTPUT-001：工具输出/错误截断（与 Python 版同阈值）。 */
const MAX_TOOL_OUTPUT_LEN = 100_000;
const MAX_TOOL_ERROR_LEN = 20_000;

/** MEMORY-EVENTS-001：写类记忆工具（done 后合成 memory_* 事件流）。 */
const MEMORY_WRITE_TOOLS = new Set(["remember_memory"]);

export interface ChatWsHub {
  sessions: Map<string, PiSessionRecord>;
  pendingPlans: Map<string, PiPendingPlan>;
  /** sessionId → 活跃连接集合（MULTI-WS-001）。 */
  connections: Map<string, Set<ServerWebSocket<WsData>>>;
  /** sessionId → 已成功执行的 client_msg_id（IDEMPOTENCY-001，内存级）。 */
  seenClientMsgIds: Map<string, string[]>;
  /** RPC 调用（kernel in-process，server.ts 注入——与 sessions.ts 的 callRpc 同实现）。 */
  callRpc: (
    method: string,
    params: Record<string, unknown>,
  ) => Promise<{ ok: true; result: unknown } | { ok: false; error: string }>;
  /** 向指定会话广播事件（原始出口，不经富化）。 */
  broadcast: (sessionId: string, event: { type: string; payload?: unknown }) => void;
}

export interface WsData {
  sessionId: string;
}

// ── 回合状态（2.3b 富化层核心）──

interface TurnState {
  turnId: string;
  userMessage: string;
  clientMsgId: string;
  modelName: string;
  providerId: string;
  maxTokens: number;
  startedAt: number;
  /** Provider-reported token usage from the final assistant message. */
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  /** kernel answer 事件捕获的最终回复。 */
  finalAnswer: string;
  /** MEMORY-EVENTS-001：本轮写类记忆工具活动。 */
  memoryActivity: Array<Record<string, unknown>>;
  /** cancel 标记（done 到达时按 cancelled 闭合）。 */
  cancelled: boolean;
}

const turnStates = new Map<string, TurnState>();

interface PendingTaskBrief {
  turnId: string;
  originalRequest: string;
  answers: string[];
  model: NonNullable<PiSessionRecord["session"]["model"]>;
  runtime: PiSessionRecord["session"]["modelRuntime"];
  result: TaskBriefResult | null;
  busy: boolean;
  rounds: number;
  promptOptions: Record<string, unknown>;
}
const taskBriefStates = new Map<string, PendingTaskBrief>();

async function updateTaskBrief(hub: ChatWsHub, sessionId: string, pending: PendingTaskBrief): Promise<void> {
  if (pending.busy) return;
  pending.busy = true;
  hub.broadcast(sessionId, { type: "task_brief_update", payload: { turn_id: pending.turnId, status: "thinking" } });
  try {
    pending.result = await createTaskBrief(
      { originalRequest: pending.originalRequest, answers: pending.answers },
      pending.model,
      pending.runtime,
    );
    if (taskBriefStates.get(sessionId) !== pending) return;
    hub.broadcast(sessionId, { type: "task_brief_update", payload: { turn_id: pending.turnId, ...pending.result } });
  } catch (error) {
    pending.result = null;
    if (taskBriefStates.get(sessionId) !== pending) return;
    hub.broadcast(sessionId, {
      type: "task_brief_update",
      payload: {
        turn_id: pending.turnId,
        status: "fallback",
        error: error instanceof Error ? error.message : String(error),
      },
    });
  } finally {
    pending.busy = false;
  }
}
/** 每会话事件串行链（保证 done 的异步补发不破坏事件顺序）。 */
const eventChains = new Map<string, Promise<void>>();

/**
 * kernel 事件统一入口（server.ts broadcastEvent 调用）。
 * 富化 + 副作用经 per-session Promise 链串行，保持事件顺序。
 * 返回本事件在链上的完成 Promise（测试/需要顺序保证的调用方可 await）。
 */
export function onKernelEvent(
  hub: ChatWsHub,
  sessionId: string,
  event: { type: string; payload?: Record<string, unknown> },
): Promise<void> {
  const prev = eventChains.get(sessionId) ?? Promise.resolve();
  const next = prev.then(() => processKernelEvent(hub, sessionId, event)).catch(() => {});
  eventChains.set(sessionId, next);
  return next;
}

async function processKernelEvent(
  hub: ChatWsHub,
  sessionId: string,
  event: { type: string; payload?: Record<string, unknown> },
): Promise<void> {
  const state = turnStates.get(sessionId);
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const send = (type: string, pl: Record<string, unknown>) => hub.broadcast(sessionId, { type, payload: pl });

  switch (event.type) {
    case "token": {
      if (state) send("token", { token: String(payload.token ?? ""), turn_id: state.turnId });
      else send("token", payload);
      return;
    }

    case "tool_start": {
      const toolName = String(payload.tool_name ?? "");
      recordActivity("tool", "tool_start", { session_id: sessionId, tool_name: toolName, message: "调用工具" });
      try {
        getMetrics().recordToolCall(toolName);
      } catch {
        /* 指标失败不影响转发 */
      }
      if (state && MEMORY_WRITE_TOOLS.has(toolName)) {
        state.memoryActivity.push({ kind: "start", tool_name: toolName, input: payload.input ?? "" });
      }
      if (state) send("tool_start", { turn_id: state.turnId, tool_name: toolName, input: payload.input ?? "" });
      else send("tool_start", payload);
      return;
    }

    case "tool_end": {
      const toolName = String(payload.tool_name ?? "");
      recordActivity("tool", "tool_end", { session_id: sessionId, tool_name: toolName, message: "工具执行完成" });
      if (state && MEMORY_WRITE_TOOLS.has(toolName)) {
        state.memoryActivity.push({
          kind: "end",
          tool_name: toolName,
          output: payload.output ?? "",
          elapsed: payload.elapsed ?? 0,
        });
      }
      try {
        getMetrics().recordToolCall(toolName, Number(payload.elapsed ?? 0) * 1000, false);
      } catch {
        /* noop */
      }
      // PERF-TOOL-OUTPUT-001：截断超大工具输出
      let rawOutput = String(payload.output ?? "");
      let truncated = false;
      if (rawOutput.length > MAX_TOOL_OUTPUT_LEN) {
        rawOutput = rawOutput.slice(0, MAX_TOOL_OUTPUT_LEN) + "\n…（输出过长，已截断）";
        truncated = true;
      }
      send("tool_end", {
        ...(state ? { turn_id: state.turnId } : {}),
        tool_name: toolName,
        output: rawOutput,
        elapsed: payload.elapsed ?? 0,
        truncated,
      });
      // Phase 2.2：写类工具输出 → 合成 artifact 事件（用未截断原文提取路径）
      if (FILE_WRITING_TOOLS.has(toolName)) {
        const filePath = extractFilePathFromOutput(String(payload.output ?? ""));
        if (filePath) {
          const artifact = buildArtifactPayload(filePath);
          if (artifact) send("artifact", artifact);
        }
      }
      return;
    }

    case "tool_error": {
      const toolName = String(payload.tool_name ?? "");
      recordActivity("tool", "tool_error", {
        session_id: sessionId,
        tool_name: toolName,
        level: "error",
        message: String(payload.error ?? "") || "工具执行出错",
      });
      // DIAG-WIRE-001：工具执行错误写入收集器（诊断报告可定位到工具）
      try {
        getErrorCollector().addError("ERROR", "tool", `[${toolName}] ${String(payload.error ?? "").slice(0, 500)}`, {
          session_id: sessionId,
          logger_name: "sidecar.tool",
          tool_name: toolName,
        });
      } catch {
        /* 收集器故障不影响主流程 */
      }
      if (state && MEMORY_WRITE_TOOLS.has(toolName)) {
        state.memoryActivity.push({ kind: "error", tool_name: toolName, error: payload.error ?? "" });
      }
      try {
        getMetrics().recordToolCall(toolName, undefined, true);
      } catch {
        /* noop */
      }
      let rawError = String(payload.error ?? "");
      if (rawError.length > MAX_TOOL_ERROR_LEN) {
        rawError = rawError.slice(0, MAX_TOOL_ERROR_LEN) + "\n…（错误详情过长，已截断）";
      }
      send("tool_error", {
        ...(state ? { turn_id: state.turnId } : {}),
        tool_name: toolName,
        error: rawError,
      });
      return;
    }

    case "error": {
      // A2：sidecar 只给 code+message，补 trace_id 并按 code 映射 category
      const errorCode = String(payload.code ?? "SIDECAR_ERROR");
      const errorMessage = String(payload.message ?? "") || "Sidecar error";
      const traceId = crypto.randomUUID().replace(/-/g, "");
      const systemErrorCodes = new Set([
        "AGENT_ERROR",
        "SIDECAR_ERROR",
        "PROMPT_ERROR",
        "PROMPT_TIMEOUT",
        "SIDECAR_UNAVAILABLE",
        "MODEL_CONFIG_ERROR",
      ]);
      const category = systemErrorCodes.has(errorCode) ? "system_error" : "tool_error";
      const diagnostic = payload.diagnostic && typeof payload.diagnostic === "object"
        ? payload.diagnostic as Record<string, unknown>
        : {};
      const diagnosticContext = {
        ...diagnostic,
        stage: diagnostic.stage ?? "agent_runtime",
        error_code: errorCode,
        turn_id: state?.turnId ?? null,
        provider_id: state?.providerId ?? null,
        model_name: state?.modelName ?? null,
        max_tokens: state?.maxTokens ?? null,
        input_chars: state?.userMessage.length ?? null,
        elapsed_ms: state ? Math.round(performance.now() - state.startedAt) : null,
      };
      // DIAG-WIRE-001：sidecar 错误同步写入收集器（带 trace_id/session_id）
      try {
        getErrorCollector().addError("ERROR", "agent", `[${errorCode}] ${errorMessage}`, {
          trace_id: traceId,
          session_id: sessionId,
          request_id: state?.turnId ?? null,
          logger_name: "sidecar",
          ...diagnosticContext,
        });
      } catch {
        /* 收集器故障不影响主流程 */
      }
      recordActivity("turn", "error", {
        session_id: sessionId,
        level: "error",
        message: errorMessage,
      });
      send("error", {
        ...(state ? { turn_id: state.turnId } : {}),
        code: errorCode,
        message: errorMessage,
        trace_id: traceId,
        category,
        diagnostic: diagnosticContext,
      });
      return;
    }

    case "answer": {
      // 吞流捕获（Python _on_answer 同语义——done 时统一重发带 turn_id 的 answer）
      if (state) state.finalAnswer = String(payload.content ?? "");
      if (state && payload.usage && typeof payload.usage === "object") {
        const usage = payload.usage as Record<string, unknown>;
        state.usage = {
          input: Number(usage.input) || 0,
          output: Number(usage.output) || 0,
          cacheRead: Number(usage.cacheRead) || 0,
          cacheWrite: Number(usage.cacheWrite) || 0,
        };
      }
      return;
    }

    case "done": {
      if (!state) return; // 无活跃回合：吞掉（兼容补发的 idle done 不下发前端）
      await finishTurn(hub, sessionId, state);
      return;
    }

    case "deferred_subagent_submitted": {
      // AG-SUBAGENT-001：生命周期状态映射后写入 DeferredRunManager，原样转发
      try {
        const rawStatus = String(payload.status ?? "queued");
        const mapped: Record<string, string> = { completed: "succeeded", failed: "failed", aborted: "cancelled" };
        getDeferredRunManager().addOrUpdate(sessionId, {
          run_id: payload.run_id ?? "",
          parent_turn_id: payload.parent_turn_id ?? null,
          status: mapped[rawStatus] ?? rawStatus,
          task: payload.task ?? "",
          name: payload.name ?? "",
          result_ref: payload.result_ref ?? null,
          result: payload.result ?? null,
          cancel_reason: payload.cancel_reason ?? null,
          deadline_at: payload.deadline_at ?? null,
          attempts: payload.attempts ?? 0,
          error_code: payload.error_code ?? null,
        });
      } catch (err) {
        console.warn(`[deferred] Failed to store deferred run: ${String(err)}`);
      }
      send("deferred_subagent_submitted", payload);
      return;
    }

    default: {
      // 其余事件透传（ask_user/context_*/thinking_*/retry_*/notice/plan_*/goal_updated…）
      send(event.type, payload);
    }
  }
}

/** done 到达 → 闭合回合（Python _handle_turn_result 成功/取消路径直译）。 */
async function finishTurn(hub: ChatWsHub, sessionId: string, state: TurnState): Promise<void> {
  turnStates.delete(sessionId);
  taskBriefStates.delete(sessionId);

  if (state.cancelled) {
    hub.broadcast(sessionId, { type: "done", payload: { turn_id: state.turnId, cancelled: true } });
    recordActivity("turn", "turn_cancelled", {
      session_id: sessionId,
      turn_id: state.turnId,
      message: "对话轮次被取消",
    });
    return;
  }

  if (state.finalAnswer) {
    hub.broadcast(sessionId, {
      type: "answer",
      payload: { turn_id: state.turnId, content: state.finalAnswer },
    });
    // IDEMPOTENCY-001：turn 成功后才登记幂等 id（失败轮次可重试）
    if (state.clientMsgId) {
      const ids = hub.seenClientMsgIds.get(sessionId) ?? [];
      if (!ids.includes(state.clientMsgId)) {
        ids.push(state.clientMsgId);
        hub.seenClientMsgIds.set(sessionId, ids);
      }
    }
  }

  // 上下文用量（kernel get_messages → 粗估，与 Python _calculate_context_usage 同口径）
  let messages: Array<Record<string, unknown>> = [];
  try {
    const result = await hub.callRpc("get_messages", { session_id: sessionId, limit: 200 });
    if (result.ok) messages = (result.result as { messages?: Array<Record<string, unknown>> }).messages ?? [];
  } catch {
    /* 用量估算失败不阻断 done */
  }
  const contextUsage = calculateContextUsage(messages, "", {
    maxTokens: state.maxTokens,
    modelName: state.modelName,
  });
  const usagePayload = state.usage;
  if (usagePayload) {
    Object.assign(contextUsage as Record<string, unknown>, {
      input_tokens: usagePayload.input ?? 0,
      output_tokens: usagePayload.output ?? 0,
      cache_read_tokens: usagePayload.cacheRead ?? 0,
      cache_write_tokens: usagePayload.cacheWrite ?? 0,
      cache_hit_rate: (usagePayload.cacheRead ?? 0) + (usagePayload.input ?? 0) > 0
        ? (usagePayload.cacheRead ?? 0) / ((usagePayload.cacheRead ?? 0) + (usagePayload.input ?? 0))
        : null,
      latency_ms: Math.max(0, performance.now() - state.startedAt),
      output_speed: (usagePayload.output ?? 0) / Math.max(0.1, (performance.now() - state.startedAt) / 1000),
    });
  }

  // METRICS-WIRE-001：LLM 调用指标
  try {
    getMetrics().recordLlmCall(
      state.modelName,
      state.usage?.input ?? contextUsage.estimated_tokens,
      state.usage?.output ?? Math.max(0, Math.floor(state.finalAnswer.length / 2)),
      Math.max(0, performance.now() - state.startedAt),
      state.usage?.cacheRead ?? 0,
      state.usage?.cacheWrite ?? 0,
      state.usage?.input == null || state.usage?.output == null,
    );
  } catch {
    /* noop */
  }

  hub.broadcast(sessionId, {
    type: "done",
    payload: {
      turn_id: state.turnId,
      context_usage: contextUsage,
      // UX-EMPTY-001：空回复标记
      empty: !state.finalAnswer,
    },
  });

  // MEMORY-EVENTS-001：done 之后批量合成 memory 事件流（顺序契约）
  if (state.memoryActivity.length > 0) {
    const doneTurnId = state.turnId;
    hub.broadcast(sessionId, { type: "memory_start", payload: { turn_id: doneTurnId } });
    for (const act of state.memoryActivity) {
      if (act.kind === "start") {
        hub.broadcast(sessionId, {
          type: "memory_tool_start",
          payload: { turn_id: doneTurnId, tool_name: act.tool_name ?? "", input: act.input ?? "" },
        });
      } else if (act.kind === "end") {
        hub.broadcast(sessionId, {
          type: "memory_tool_end",
          payload: { turn_id: doneTurnId, tool_name: act.tool_name ?? "", output: act.output ?? "", elapsed: act.elapsed ?? 0 },
        });
      } else if (act.kind === "error") {
        hub.broadcast(sessionId, {
          type: "memory_tool_error",
          payload: { turn_id: doneTurnId, tool_name: act.tool_name ?? "", error: act.error ?? "" },
        });
      }
    }
    hub.broadcast(sessionId, { type: "memory_done", payload: { turn_id: doneTurnId } });
  }

  recordActivity("turn", "turn_end", {
    session_id: sessionId,
    turn_id: state.turnId,
    // PERF-ACTIVITY-001：完整回复只保留摘要
    message: (state.finalAnswer || "(本轮无最终回复)").slice(0, 500),
    payload: { context_usage: contextUsage },
  });
}

// ── WS per-session 限流（api/middleware/rate_limit.py WsSessionRateLimiter 直译）──

interface WsBucket {
  tokens: number;
  lastRefill: number;
}

const WS_CAPACITY = 60;
const WS_REFILL_RATE = 1.0; // 60 per 60s
const wsBuckets = new Map<string, WsBucket>();

function wsTryConsume(sessionId: string): { allowed: boolean; errorPayload?: Record<string, unknown> } {
  const now = Date.now() / 1000;
  let bucket = wsBuckets.get(sessionId);
  if (!bucket) {
    bucket = { tokens: WS_CAPACITY, lastRefill: now };
    wsBuckets.set(sessionId, bucket);
  } else {
    const elapsed = now - bucket.lastRefill;
    if (elapsed > 0) {
      bucket.tokens = Math.min(WS_CAPACITY, bucket.tokens + elapsed * WS_REFILL_RATE);
      bucket.lastRefill = now;
    }
  }
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true };
  }
  const remaining = bucket.tokens;
  const retryAfter = remaining < 1 ? Math.max(1, Math.round((1 - remaining) / WS_REFILL_RATE)) : 1;
  return {
    allowed: false,
    errorPayload: {
      code: "RATE_LIMITED",
      message: "消息发送过于频繁，请稍后重试",
      category: "rate_limit",
      details: { retry_after: retryAfter, limit: WS_CAPACITY, remaining: Math.floor(remaining) },
    },
  };
}

// ── 连接生命周期 ──

/** 注册 WS 连接（server.ts upgrade 成功后调用）。 */
export function registerChatConnection(hub: ChatWsHub, sessionId: string, ws: ServerWebSocket<WsData>): void {
  let set = hub.connections.get(sessionId);
  if (!set) {
    set = new Set();
    hub.connections.set(sessionId, set);
  }
  set.add(ws);
  // server 首帧：协议握手（阶段〇-3 契约）
  ws.send(JSON.stringify({ type: "hello", payload: { protocol_version: 1 } }));
}

/** 注销连接（AG-CONTEXT-001：不销毁会话；最后一连接断开时取消在途回合）。 */
export function unregisterChatConnection(hub: ChatWsHub, sessionId: string, ws: ServerWebSocket<WsData>): void {
  const set = hub.connections.get(sessionId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) {
    hub.connections.delete(sessionId);
    if (taskBriefStates.has(sessionId)) {
      taskBriefStates.delete(sessionId);
      turnStates.delete(sessionId);
    }
    // Python finally 语义：WS 断开取消在途 turn（kernel cancel → done{cancelled}）
    const state = turnStates.get(sessionId);
    if (state) {
      state.cancelled = true;
      void hub.callRpc("cancel", { session_id: sessionId }).catch(() => {});
    }
  }
}

// ── client 消息分发 ──

/** 处理一条 client 消息（server.ts websocket.message 调用）。 */
export function handleChatMessage(hub: ChatWsHub, ws: ServerWebSocket<WsData>, raw: string | Buffer): void {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return;
  }
  if (!msg || typeof msg !== "object") return;

  const sessionId = ws.data.sessionId;
  const msgType = String(msg.type ?? "");
  const record = hub.sessions.get(sessionId);

  // ── ping（SESSION-ACTIVE-001：刷新活跃）──
  if (msgType === "ping") {
    ws.send(JSON.stringify({ type: "pong" }));
    return;
  }

  // 白名单外静默丢弃
  if (!CLIENT_MESSAGE_TYPES.has(msgType)) return;

  const payload = (msg.payload ?? {}) as Record<string, unknown>;

  // ── cancel ──
  if (msgType === "cancel") {
    const pendingBrief = taskBriefStates.get(sessionId);
    if (pendingBrief) {
      taskBriefStates.delete(sessionId);
      void onKernelEvent(hub, sessionId, { type: "done", payload: { turn_id: pendingBrief.turnId, cancelled: true } });
      return;
    }
    const state = turnStates.get(sessionId);
    if (record?.currentGuard && state) {
      state.cancelled = true;
      // AG-IDEMPOTENCY-001：cancel 前已产出最终回复 → 补发 answer(partial)
      // 并登记幂等 id（在 done{cancelled} 之前送达，保持前端 answer→done 顺序）
      void hub
        .callRpc("get_messages", { session_id: sessionId, limit: 4 })
        .then((result) => {
          if (!result.ok) return;
          const messages = (result.result as { messages?: Array<Record<string, unknown>> }).messages ?? [];
          let lastAnswer = "";
          for (const m of messages) {
            if (m.role === "assistant" && String(m.content ?? "").trim()) lastAnswer = String(m.content);
          }
          if (lastAnswer) {
            hub.broadcast(sessionId, {
              type: "answer",
              payload: { turn_id: state.turnId, content: lastAnswer, partial: true },
            });
            if (state.clientMsgId) {
              const ids = hub.seenClientMsgIds.get(sessionId) ?? [];
              if (!ids.includes(state.clientMsgId)) {
                ids.push(state.clientMsgId);
                hub.seenClientMsgIds.set(sessionId, ids);
              }
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          void hub.callRpc("cancel", { session_id: sessionId }).catch(() => {});
        });
      return;
    }
    if (record) {
      void hub.callRpc("cancel", { session_id: sessionId }).catch(() => {});
    }
    return;
  }

  if (msgType === "task_brief_answer") {
    const pending = taskBriefStates.get(sessionId);
    const answer = String(payload.answer ?? "").trim().slice(0, 4000);
    if (!pending || pending.busy || pending.result?.status !== "clarify" || !answer) return;
    pending.answers.push(answer);
    pending.rounds += 1;
    if (pending.rounds > 4) {
      pending.result = null;
      hub.broadcast(sessionId, { type: "task_brief_update", payload: { turn_id: pending.turnId, status: "fallback", error: "澄清轮次已达上限，可使用原始请求执行。" } });
      return;
    }
    void updateTaskBrief(hub, sessionId, pending);
    return;
  }

  if (msgType === "task_brief_execute") {
    const pending = taskBriefStates.get(sessionId);
    if (!pending || pending.busy) return;
    if (payload.use_original !== true && pending.result?.status !== "ready") return;
    const message = payload.use_original === true
      ? pending.originalRequest
      : typeof payload.execution_prompt === "string" ? payload.execution_prompt.trim().slice(0, 20_000) : "";
    if (!message) return;
    taskBriefStates.delete(sessionId);
    void hub.callRpc("prompt", { session_id: sessionId, message, ...pending.promptOptions }).then((result) => {
      if (!result.ok) {
        void onKernelEvent(hub, sessionId, { type: "error", payload: { code: "TASK_BRIEF_EXECUTE_ERROR", message: result.error } });
        void onKernelEvent(hub, sessionId, { type: "done", payload: { turn_id: pending.turnId } });
      }
    }).catch((error) => {
      void onKernelEvent(hub, sessionId, { type: "error", payload: { code: "TASK_BRIEF_EXECUTE_ERROR", message: String(error) } });
      void onKernelEvent(hub, sessionId, { type: "done", payload: { turn_id: pending.turnId } });
    });
    return;
  }

  if (msgType === "task_brief_cancel") {
    const pending = taskBriefStates.get(sessionId);
    if (pending) {
      taskBriefStates.delete(sessionId);
      void onKernelEvent(hub, sessionId, { type: "done", payload: { turn_id: pending.turnId, cancelled: true } });
    }
    return;
  }

  // ── user_response（ask_user 应答）──
  if (msgType === "user_response") {
    void hub.callRpc("user_response", { session_id: sessionId, ...payload }).catch(() => {});
    return;
  }

  // ── update_auto_approve ──
  if (msgType === "update_auto_approve") {
    const autoApprove = Boolean(payload.auto_approve);
    void hub
      .callRpc("set_auto_approve", { session_id: sessionId, auto_approve: autoApprove })
      .catch(() => {});
    return;
  }

  // ── plan_response → plan_action ──
  if (msgType === "plan_response") {
    const planPayload: Record<string, unknown> = {
      session_id: sessionId,
      plan_id: String(payload.plan_id ?? ""),
      action: String(payload.action ?? ""),
    };
    if (payload.modified_plan) planPayload.modified_plan = payload.modified_plan;
    void hub.callRpc("plan_action", planPayload).catch(() => {});
    return;
  }

  // ── set_plan_mode ──
  if (msgType === "set_plan_mode") {
    void hub
      .callRpc("set_plan_mode", { session_id: sessionId, enabled: Boolean(payload.enabled) })
      .catch(() => {});
    return;
  }

  // ── checkpoint_action ──
  if (msgType === "checkpoint_action") {
    const checkpointPayload: Record<string, unknown> = {
      session_id: sessionId,
      action: String(payload.action ?? ""),
    };
    if (payload.goal) checkpointPayload.goal = payload.goal;
    void hub.callRpc("checkpoint_action", checkpointPayload).catch(() => {});
    return;
  }

  // ── goal_action（回执带最新 goal 状态）──
  if (msgType === "goal_action") {
    const goalPayload: Record<string, unknown> = {
      session_id: sessionId,
      action: String(payload.action ?? ""),
    };
    if (payload.objective) goalPayload.objective = payload.objective;
    if (payload.token_budget !== undefined && payload.token_budget !== null) {
      goalPayload.token_budget = payload.token_budget;
    }
    void hub
      .callRpc("goal_action", goalPayload)
      .then((result) => {
        if (result.ok) {
          const state = (result.result as { state?: unknown }).state;
          if (state) {
            const goalState = state as { goal?: unknown };
            hub.broadcast(sessionId, { type: "goal_updated", payload: { goal: goalState.goal, state } });
          }
        }
      })
      .catch(() => {});
    return;
  }

  // ── artifact_action（token=base64(路径) → 读文件 → artifact_result）──
  if (msgType === "artifact_action") {
    const artifactId = String(payload.artifact_id ?? "");
    const actionId = String(payload.action_id ?? "");
    const token = String(payload.token ?? "");
    let fileContent: string | null = null;
    let fileError: string | null = null;
    if (token) {
      try {
        const filePath = Buffer.from(token, "base64").toString("utf8");
        const fsMod = require("node:fs") as typeof import("node:fs");
        if (fsMod.existsSync(filePath) && fsMod.statSync(filePath).isFile()) {
          fileContent = fsMod.readFileSync(filePath, "utf8");
        } else {
          fileError = "File not found";
        }
      } catch (err) {
        fileError = String(err);
      }
    }
    ws.send(
      JSON.stringify({
        type: "artifact_result",
        payload: {
          artifact_id: artifactId,
          action_id: actionId,
          status: fileContent !== null ? "completed" : "error",
          content: fileContent,
          error: fileError,
        },
      }),
    );
    return;
  }

  // ── chat（发起 turn）──
  if (msgType === "chat") {
    const userMessage = String(payload.message ?? "").trim();
    if (!userMessage) return;

    // IDEMPOTENCY-001：client_msg_id 幂等去重
    const clientMsgId = payload.client_msg_id;
    const seenIds = hub.seenClientMsgIds.get(sessionId) ?? [];
    if (typeof clientMsgId === "string" && clientMsgId) {
      if (seenIds.includes(clientMsgId)) {
        console.info(`[ws] 重复 client_msg_id=${clientMsgId.slice(0, 12)} 已忽略（幂等去重）`);
        return;
      }
    }

    // CONN-MUTEX-001：运行中拒绝新 turn。turnStates 在 chat 接受时同步登记、
    // done 时清除——比 kernel currentGuard（异步置位）更早，消除竞态窗口。
    if (record?.currentGuard || turnStates.has(sessionId)) {
      hub.broadcast(sessionId, {
        type: "error",
        payload: {
          code: "BUSY",
          message: "上一条消息仍在处理中，请稍后",
          category: "system_error",
          trace_id: crypto.randomUUID().replace(/-/g, ""),
        },
      });
      return;
    }

    // WS per-session 限流（超限 → error{RATE_LIMITED} 仅回本连接）
    const rl = wsTryConsume(sessionId);
    if (!rl.allowed) {
      ws.send(JSON.stringify({ type: "error", payload: rl.errorPayload }));
      return;
    }

    // 回合状态登记（done 到达时闭合）
    const turnId = newTurnId(payload.turn_id);
    turnStates.set(sessionId, {
      turnId,
      userMessage,
      clientMsgId: typeof clientMsgId === "string" ? clientMsgId : "",
      modelName: String(payload.model_name ?? ""),
      providerId: String(payload.provider_id ?? ""),
      maxTokens: 256_000,
      startedAt: performance.now(),
      finalAnswer: "",
      memoryActivity: [],
      cancelled: false,
    });

    recordActivity("turn", "turn_start", { session_id: sessionId, turn_id: turnId, message: userMessage });

    void (async () => {
      try {
        const providerId = typeof payload.provider_id === "string" ? payload.provider_id : "";
        const modelName = typeof payload.model_name === "string" ? payload.model_name : "";
        let selectedModel = record?.session.model;
        if (providerId && modelName) {
          const provider = findProvider(loadProviders(), providerId);
          if (!provider || provider.enabled === false) {
            throw new Error(`所选提供商不可用：${providerId}`);
          }
          const resolved = await resolvePiModel(
            {
              model: modelName,
              provider: providerId,
              baseUrl: typeof provider.base_url === "string" ? provider.base_url : undefined,
              apiKey: decryptProviderKey(provider.api_key),
              providerType: typeof provider.provider_type === "string" ? provider.provider_type : undefined,
              contextWindow: Number(provider.context_window) || undefined,
              maxTokens: Number(payload.max_tokens) || undefined,
            },
            record?.session.modelRuntime,
          );
          if (!record) throw new Error(`会话不存在：${sessionId}`);
          selectedModel = resolved.model;
          await record.session.setModel(resolved.model);
        }
        const promptOptions = {
          ...(typeof payload.thinking === "string" && payload.thinking
            ? { thinking_level: payload.thinking }
            : typeof payload.thinking === "boolean"
              ? { thinking_level: payload.thinking ? "high" : "off" }
              : {}),
          ...(payload.model_name ? { model_name: payload.model_name } : {}),
          ...(payload.provider_id ? { provider_id: payload.provider_id } : {}),
          ...(typeof payload.temperature === "number" && payload.temperature >= -1 && payload.temperature <= 2
            ? { temperature: payload.temperature }
            : {}),
          ...(typeof payload.max_tokens === "number" && payload.max_tokens > 0 && payload.max_tokens <= 65536
            ? { max_tokens: Math.floor(payload.max_tokens) }
            : {}),
        };
        if (payload.task_brief === true) {
          if (!record || !selectedModel) throw new Error("当前会话没有可用模型，无法进行需求对齐");
          const pending: PendingTaskBrief = {
            turnId,
            originalRequest: userMessage,
            answers: [],
            model: selectedModel,
            runtime: record.session.modelRuntime,
            result: null,
            busy: false,
            rounds: 0,
            promptOptions,
          };
          taskBriefStates.set(sessionId, pending);
          await updateTaskBrief(hub, sessionId, pending);
          return { ok: true as const, result: null };
        }
        return hub.callRpc("prompt", {
          session_id: sessionId,
          message: userMessage,
          ...promptOptions,
        });
      } catch (error) {
        await onKernelEvent(hub, sessionId, {
          type: "error",
          payload: {
            code: "MODEL_CONFIG_ERROR",
            message: error instanceof Error ? error.message : String(error),
            diagnostic: {
              name: error instanceof Error ? error.name : typeof error,
              stack: error instanceof Error ? error.stack ?? null : null,
              stage: "model_resolution",
            },
          },
        });
        await onKernelEvent(hub, sessionId, { type: "done", payload: {} });
        return { ok: true as const, result: null };
      }
    })()
      .then((result) => {
        if (!result.ok) {
          turnStates.delete(sessionId);
          // DIAG-WIRE-001：turn 级失败写入收集器（带 trace_id/session_id，
          // 对齐 Python chat.py turn-task except 分支）
          try {
            getErrorCollector().addError("ERROR", "agent", `[SIDECAR_UNAVAILABLE] ${result.error}`, {
              trace_id: crypto.randomUUID().replace(/-/g, ""),
              session_id: sessionId,
              logger_name: "chat.turn",
            });
          } catch {
            /* 收集器故障不影响主流程 */
          }
          hub.broadcast(sessionId, {
            type: "error",
            payload: { message: result.error, category: "system_error" },
          });
        }
      })
      .catch((err) => {
        turnStates.delete(sessionId);
        try {
          getErrorCollector().addError("ERROR", "agent", `[SIDECAR_UNAVAILABLE] ${String(err)}`, {
            trace_id: crypto.randomUUID().replace(/-/g, ""),
            session_id: sessionId,
            logger_name: "chat.turn",
          });
        } catch {
          /* 收集器故障不影响主流程 */
        }
        hub.broadcast(sessionId, {
          type: "error",
          payload: { message: String(err), category: "system_error" },
        });
      });
    return;
  }
}
