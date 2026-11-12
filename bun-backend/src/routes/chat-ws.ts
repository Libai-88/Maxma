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
import { getEvolutionContext, learnFromUserMessage } from "../evolution-ledger";

import { record as recordActivity } from "../activity-hub";
import { decryptProviderKey, findProvider, loadProviders } from "./providers";
import { isPluginProvider } from "../plugins/dsh";
import { getMetrics } from "../metrics";
import { recordLlmUsageCall, type LlmCacheStatus } from "../llm-usage-ledger";
import { getErrorCollector } from "../error-collector";
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
  "steer",
  "follow_up",
  "task_review",
]);

/** PERF-TOOL-OUTPUT-001：工具输出/错误截断（与 Python 版同阈值）。 */
const MAX_TOOL_OUTPUT_LEN = 100_000;
const MAX_TOOL_ERROR_LEN = 20_000;

/** EvoCore：只在已有请求路径上做确定性规则提炼与按需检索，不额外调用模型。 */
function enrichWithEvolutionContext(message: string, sessionId: string, turnId: string): string {
  try {
    learnFromUserMessage(message, sessionId, turnId);
    return `${message}${getEvolutionContext(message)}`;
  } catch (error) {
    console.warn(`[evolution] context unavailable: ${String(error)}`);
    return message;
  }
}

/** MEMORY-EVENTS-001：写类记忆工具（done 后合成 memory_* 事件流）。 */
const MEMORY_WRITE_TOOLS = new Set(["remember_memory"]);

/**
 * Kernel RPC 的统一结果形态：**永不 reject**——失败解析为 `{ ok: false, error }`
 * （见 server.ts 的 callKernelRpc）。消费方必须显式处理 `ok:false` 分支，
 * 不许用 `.catch()` 兜底冒充错误处理（ACTION-FAIL-001）。
 */
export type KernelRpcResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

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
  ) => Promise<KernelRpcResult>;
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
  priceStatus: "catalog_estimate" | "unknown";
  cacheStatus: "catalog" | "unknown";
  modelUsageRequests: Array<{ usage: Record<string, unknown> | null; durationMs: number | null; cacheStatus: "catalog" | "observed" | "unknown" }>;
  requestCount: number;
  /** Provider-reported token usage from the final assistant message. */
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

interface PendingTaskReview {
  turnId: string;
  answer: string;
}
const taskReviewStates = new Map<string, PendingTaskReview>();

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

/**
 * 把 `llm_usage` 转发给前端（落库之后、原样语义、只留 UI 需要的字段）。
 *
 * 此前这两个分支只落库 + 打点就 `return`，客户端永远收不到用量：
 * 对话里看不到每轮 token、走的模型、缓存是否命中，缓存预热更是完全不可见。
 * 落库与展示是两件事——记账不能替代回执。
 */
function forwardLlmUsage(
  send: (type: string, payload: Record<string, unknown>) => void,
  payload: Record<string, unknown>,
  turnId: string | null,
): void {
  const usage = payload.usage !== null && typeof payload.usage === "object"
    ? payload.usage as Record<string, unknown>
    : null;
  // 缓存观测状态按与落库同一规则派生：payload 里常常不写 cache_status，
  // 只写 cacheRead/cacheWrite 两个数字。直接透传会让前端永远看到 null
  // （"缓存未观测"），而落库那侧同一帧其实是 observed。
  const hasBothCache = usage !== null
    && typeof usage.cacheRead === "number" && Number.isFinite(usage.cacheRead)
    && typeof usage.cacheWrite === "number" && Number.isFinite(usage.cacheWrite);
  const derivedCacheStatus = hasBothCache
    ? "observed"
    : payload.cache_status === "catalog" ? "catalog" : "unknown";
  const out: Record<string, unknown> = {
    kind: payload.kind,
    usage: usage
      ? {
          input: usage.input ?? null,
          output: usage.output ?? null,
          cacheRead: usage.cacheRead ?? null,
          cacheWrite: usage.cacheWrite ?? null,
        }
      : null,
    provider: typeof payload.provider === "string" ? payload.provider : null,
    model: typeof payload.model === "string" ? payload.model : null,
    request_duration_ms: typeof payload.request_duration_ms === "number" ? payload.request_duration_ms : null,
    price_status: typeof payload.price_status === "string" ? payload.price_status : null,
    cache_status: derivedCacheStatus,
  };
  if (turnId) out.turn_id = turnId;
  send("llm_usage", out);
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
      if (state) state.finalAnswer = String(payload.content ?? "");
      const usage = payload.usage !== null && typeof payload.usage === "object"
        ? payload.usage as Record<string, unknown>
        : null;
      const requestIndex = state ? ++state.requestCount : null;
      const requestModel = String(payload.model ?? state?.modelName ?? "") || null;
      const requestProvider = String(payload.provider ?? state?.providerId ?? "") || null;
      const durationMs = typeof payload.request_duration_ms === "number" && Number.isFinite(payload.request_duration_ms)
        ? Math.max(0, payload.request_duration_ms)
        : null;
      const reportedCache = usage && typeof usage.cacheRead === "number" && Number.isFinite(usage.cacheRead) && usage.cacheRead >= 0 && typeof usage.cacheWrite === "number" && Number.isFinite(usage.cacheWrite) && usage.cacheWrite >= 0;
      const cacheStatus: LlmCacheStatus = reportedCache
        ? "observed"
        : state?.cacheStatus ?? "unknown";
      if (state) state.modelUsageRequests.push({ usage, durationMs, cacheStatus });
      try {
        const recorded = recordLlmUsageCall({
          sessionId,
          turnId: state?.turnId ?? null,
          requestIndex,
          kind: "model_request",
          usageSource: "pi_message_end",
          provider: requestProvider,
          model: requestModel,
          usage,
          priceStatus: state?.priceStatus ?? "unknown",
          cacheStatus,
          requestShapeHash: typeof payload.request_shape_hash === "string" ? payload.request_shape_hash : null,
          prefixFingerprint: typeof payload.prefix_fingerprint === "string" ? payload.prefix_fingerprint : null,
          fingerprintEpoch: typeof payload.fingerprint_epoch === "string" ? payload.fingerprint_epoch : null,
          durationMs,
        });
        if (recorded.inserted) getMetrics().recordLlmUsageRequest(requestModel ?? "unknown", usage, durationMs, {
          kind: "model_request",
          cacheStatus,
        });
      } catch (error) {
        console.warn(`[llm-usage] failed to record model request: ${String(error)}`);
      }
      return;
    }

    case "llm_usage": {
      const usage = payload.usage !== null && typeof payload.usage === "object"
        ? payload.usage as Record<string, unknown>
        : null;
      if (payload.kind === "model_request") {
        const reportedCache = usage && typeof usage.cacheRead === "number" && Number.isFinite(usage.cacheRead) && usage.cacheRead >= 0 && typeof usage.cacheWrite === "number" && Number.isFinite(usage.cacheWrite) && usage.cacheWrite >= 0;
        const cacheStatus: LlmCacheStatus = reportedCache ? "observed" : payload.cache_status === "catalog" ? "catalog" : "unknown";
        const durationMs = typeof payload.request_duration_ms === "number" && Number.isFinite(payload.request_duration_ms)
          ? Math.max(0, payload.request_duration_ms)
          : null;
        const provider = typeof payload.provider === "string" ? payload.provider : null;
        const model = typeof payload.model === "string" ? payload.model : null;
        try {
          const recorded = recordLlmUsageCall({
            sessionId,
            turnId: null,
            kind: "model_request",
            usageSource: "pi_message_end",
            provider,
            model,
            usage,
            priceStatus: payload.price_status === "catalog_estimate" ? "catalog_estimate" : "unknown",
            cacheStatus,
            requestShapeHash: typeof payload.request_shape_hash === "string" ? payload.request_shape_hash : null,
            prefixFingerprint: typeof payload.prefix_fingerprint === "string" ? payload.prefix_fingerprint : null,
            fingerprintEpoch: typeof payload.fingerprint_epoch === "string" ? payload.fingerprint_epoch : null,
            durationMs,
          });
          if (recorded.inserted) getMetrics().recordLlmUsageRequest(model ?? "unknown", usage, durationMs, {
            kind: "model_request",
            cacheStatus,
          });
        } catch (error) {
          console.warn(`[llm-usage] failed to record hidden model request: ${String(error)}`);
        }
        forwardLlmUsage(send, payload, state?.turnId ?? null);
        return;
      }
      if (payload.kind !== "cache_warm") return;
      const reportedCache = usage && typeof usage.cacheRead === "number" && Number.isFinite(usage.cacheRead) && usage.cacheRead >= 0 && typeof usage.cacheWrite === "number" && Number.isFinite(usage.cacheWrite) && usage.cacheWrite >= 0;
      const cacheStatus: LlmCacheStatus = reportedCache ? "observed" : payload.cache_status === "catalog" ? "catalog" : "unknown";
      const occurredAt = typeof payload.occurred_at === "string" && Number.isFinite(Date.parse(payload.occurred_at))
        ? new Date(payload.occurred_at)
        : undefined;
      try {
        const recorded = recordLlmUsageCall({
          sessionId,
          sourceEntryId: typeof payload.usage_entry_id === "string" ? `${sessionId}:${payload.usage_entry_id}` : null,
          turnId: state?.turnId ?? null,
          kind: "cache_warm",
          usageSource: "pi_usage_entry",
          provider: typeof payload.provider === "string" ? payload.provider : null,
          model: typeof payload.model === "string" ? payload.model : null,
          usage,
          priceStatus: payload.price_status === "catalog_estimate" ? "catalog_estimate" : "unknown",
          cacheStatus,
          occurredAt,
        });
        if (recorded.inserted) getMetrics().recordLlmUsageRequest(String(payload.model ?? "unknown"), usage, null, {
          kind: "cache_warm",
          cacheStatus,
        });
      } catch (error) {
        console.warn(`[llm-usage] failed to record cache warm usage: ${String(error)}`);
      }
      forwardLlmUsage(send, payload, null);
      return;
    }

    case "done": {
      if (!state) return; // 无活跃回合：吞掉（兼容补发的 idle done 不下发前端）
      await finishTurn(hub, sessionId, state);
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
      payload: {
        turn_id: state.turnId,
        content: state.finalAnswer,
        // 实际产出这句话的模型（fallback 池里可能不是会话默认模型）。
        // 此前只发 content，客户端无从得知"是谁回的"，用量脚注只能猜。
        ...(state.modelName ? { model: state.modelName } : {}),
        ...(state.providerId ? { provider: state.providerId } : {}),
      },
    });
    // IDEMPOTENCY-001：turn 成功后才登记幂等 id（失败轮次可重试）
    if (state.clientMsgId) {
      const ids = hub.seenClientMsgIds.get(sessionId) ?? [];
      if (!ids.includes(state.clientMsgId)) {
        ids.push(state.clientMsgId);
        // STABILITY-008：环形上限，防长会话无界增长（幂等窗口 200 条足够）
        if (ids.length > 200) ids.splice(0, ids.length - 200);
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
  const modelRequests = state.modelUsageRequests;
  if (modelRequests.length > 0) {
    const number = (usage: Record<string, unknown> | null, key: string): number | null => {
      const value = usage?.[key];
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
    };
    const allTokensReported = modelRequests.every((request) =>
      number(request.usage, "input") !== null && number(request.usage, "output") !== null,
    );
    const allCacheObserved = modelRequests.every((request) =>
      request.cacheStatus !== "unknown" && number(request.usage, "input") !== null && number(request.usage, "cacheRead") !== null && number(request.usage, "cacheWrite") !== null,
    );
    const inputTokens = modelRequests.reduce((sum, request) => sum + (number(request.usage, "input") ?? 0), 0);
    const outputTokens = modelRequests.reduce((sum, request) => sum + (number(request.usage, "output") ?? 0), 0);
    const cacheReadTokens = modelRequests.reduce((sum, request) => sum + (number(request.usage, "cacheRead") ?? 0), 0);
    const cacheWriteTokens = modelRequests.reduce((sum, request) => sum + (number(request.usage, "cacheWrite") ?? 0), 0);
    const hasAnyTokenUsage = modelRequests.some((request) => request.usage !== null);
    const turnDurationMs = Math.max(0, performance.now() - state.startedAt);
    Object.assign(contextUsage as unknown as Record<string, unknown>, {
      model_request_count: modelRequests.length,
      usage_status: allTokensReported ? "reported" : hasAnyTokenUsage ? "partial" : "missing",
      input_tokens: allTokensReported ? inputTokens : null,
      output_tokens: allTokensReported ? outputTokens : null,
      cache_read_tokens: allCacheObserved ? cacheReadTokens : null,
      cache_write_tokens: allCacheObserved ? cacheWriteTokens : null,
      cache_hit_rate: allCacheObserved && inputTokens + cacheReadTokens > 0
        ? cacheReadTokens / (inputTokens + cacheReadTokens)
        : null,
      latency_ms: turnDurationMs,
      output_speed: allTokensReported ? outputTokens / Math.max(0.1, turnDurationMs / 1000) : null,
    });
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

  if (state.finalAnswer) {
    taskReviewStates.set(sessionId, { turnId: state.turnId, answer: state.finalAnswer });
    hub.broadcast(sessionId, {
      type: "task_review_update",
      payload: { status: "available", turn_id: state.turnId, answer: state.finalAnswer.slice(0, 1200) },
    });
  }

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
    // STABILITY-008：最后一连接断开时清掉会话级附属表，防按 sessionId 泄漏
    // （此前只删 connections/turnStates/taskBrief/taskReview，eventChains/
    //  wsBuckets/seenClientMsgIds 常驻不删，长进程下无界增长）。
    eventChains.delete(sessionId);
    wsBuckets.delete(sessionId);
    hub.seenClientMsgIds.delete(sessionId);
    if (taskBriefStates.has(sessionId)) {
      taskBriefStates.delete(sessionId);
      turnStates.delete(sessionId);
    }
    taskReviewStates.delete(sessionId);
    // Python finally 语义：WS 断开取消在途 turn（kernel cancel → done{cancelled}）
    const state = turnStates.get(sessionId);
    turnStates.delete(sessionId);
    if (state) {
      state.cancelled = true;
      // STABILITY-007：callKernelRpc 永不 reject，`.catch(() => {})` 是死代码；
      // 取消失败意味着断开后回合仍在上游烧 token——必须可观察。
      void hub.callRpc("cancel", { session_id: sessionId }).then((result) => {
        if (!result.ok) {
          getErrorCollector().addError(
            "WARN",
            "turn_cancel",
            `WS 断开后取消在途回合失败（kernel 未确认），回合可能仍在消耗上游：${result.error}`,
            { session_id: sessionId },
          );
        }
      });
    }
  }
}

// ── 回合看门狗（STABILITY-006）──
// kernel 回合挂起（error 事件未跟随 done）时 turnStates 常驻，后续每条
// chat 被 BUSY 拒绝直到重连。这里按"已登记时长"硬超时：超时的回合取消
// （kernel cancel）+ 广播 error，让客户端与 error-collector 都能看到。
const TURN_STALE_MS = 30 * 60_000;
export const TURN_WATCHDOG_INTERVAL_MS = 60_000;

export function sweepStaleTurns(hub: ChatWsHub, now: number = performance.now()): string[] {
  const stale: string[] = [];
  for (const [sessionId, state] of turnStates) {
    if (now - state.startedAt < TURN_STALE_MS) continue;
    turnStates.delete(sessionId);
    state.cancelled = true;
    stale.push(sessionId);
    void hub.callRpc("cancel", { session_id: sessionId }).then((result) => {
      if (!result.ok) {
        getErrorCollector().addError(
          "WARN",
          "turn_watchdog",
          `看门狗取消超时回合失败：${result.error}`,
          { session_id: sessionId },
        );
      }
    });
    hub.broadcast(sessionId, {
      type: "error",
      payload: {
        code: "turn_timeout",
        message: "本回合超过 30 分钟未见完成，已自动取消（内核可能无响应）。可重试或新建会话。",
        turn_id: state.turnId ?? null,
      },
    });
  }
  if (stale.length > 0) {
    console.warn(`[chat-ws] watchdog swept ${stale.length} stale turn(s): ${stale.map((s) => s.slice(0, 8)).join(",")}`);
  }
  return stale;
}

let turnWatchdogTimer: ReturnType<typeof setInterval> | undefined;

/** 启动回合看门狗（server.ts 装配；测试可直接调 sweepStaleTurns）。 */
export function startTurnWatchdog(hub: ChatWsHub): void {
  if (turnWatchdogTimer) return;
  turnWatchdogTimer = setInterval(() => {
    try {
      sweepStaleTurns(hub);
    } catch (err) {
      console.error(`[chat-ws] watchdog iteration failed: ${String(err)}`);
    }
  }, TURN_WATCHDOG_INTERVAL_MS);
  if (typeof turnWatchdogTimer.unref === "function") turnWatchdogTimer.unref();
}

export function stopTurnWatchdog(): void {
  clearInterval(turnWatchdogTimer);
  turnWatchdogTimer = undefined;
}

// ── client 消息分发 ──

/** ACTION-FAIL-001：会话级动作 RPC 的失败不再静默。
 *
 * callKernelRpc 永不 throw——失败解析为 `{ ok: false, error }`，所以
 * `.catch(() => {})` 连兜底都算不上，`ok:false` 路径更是完全不可见：
 * 乐观 UI（自动执行开关 / 计划卡 / 检查点）会停在错误值上，用户重试
 * 也毫无反应。这里按 steer/follow_up 的既有模式（collaboration_update）
 * 把失败广播回客户端，由前端 toast 呈现。cancel 类调用有意不走红：
 * 本地记录即真相（浏览器看到的事实不变），见 server.ts 的注释。 */
async function callRpcStrict(
  hub: ChatWsHub,
  sessionId: string,
  method: string,
  params: Record<string, unknown>,
  actionLabel: string,
): Promise<void> {
  let result: KernelRpcResult;
  try {
    result = await hub.callRpc(method, params);
  } catch (error) {
    hub.broadcast(sessionId, {
      type: "action_failed",
      payload: { action: actionLabel, message: String(error) },
    });
    return;
  }
  if (!result.ok) {
    hub.broadcast(sessionId, {
      type: "action_failed",
      payload: { action: actionLabel, message: result.error },
    });
  }
}

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
    const enrichedMessage = enrichWithEvolutionContext(message, sessionId, pending.turnId);
    void hub.callRpc("prompt", { session_id: sessionId, message: enrichedMessage, ...pending.promptOptions }).then((result) => {
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

  if (msgType === "task_review") {
    const review = taskReviewStates.get(sessionId);
    if (!review || turnStates.has(sessionId) || record?.currentGuard) return;
    const action = payload.action === "accept" ? "accept" : payload.action === "revise" ? "revise" : "";
    if (!action) return;
    if (action === "accept") {
      taskReviewStates.delete(sessionId);
      hub.broadcast(sessionId, { type: "task_review_update", payload: { status: "accepted", turn_id: review.turnId } });
      return;
    }
    const feedback = String(payload.feedback ?? "").trim().slice(0, 4000);
    if (!feedback) return;
    taskReviewStates.delete(sessionId);
    const turnId = newTurnId();
    const revisionMessage = `请根据用户对上一轮结果的反馈进行修订，并直接完成修订后的任务。\n用户反馈：${feedback}`;
    hub.broadcast(sessionId, { type: "task_review_update", payload: { status: "revising", turn_id: turnId, message: revisionMessage } });
    handleChatMessage(hub, ws, JSON.stringify({
      type: "chat",
      payload: { message: revisionMessage, turn_id: turnId, client_msg_id: `review-${turnId}` },
    }));
    return;
  }

  if (msgType === "steer" || msgType === "follow_up") {
    const state = turnStates.get(sessionId);
    const message = String(payload.message ?? "").trim().slice(0, 4000);
    if (!state || !record?.currentGuard || !message) return;
    const mode = msgType === "steer" ? "steer" : "follow_up";
    void hub.callRpc(mode, { session_id: sessionId, message }).then((result) => {
      if (!result.ok) {
        hub.broadcast(sessionId, { type: "collaboration_update", payload: { status: "error", mode, message: result.error } });
        return;
      }
      hub.broadcast(sessionId, { type: "collaboration_update", payload: { status: "queued", mode, message } });
    }).catch((error) => {
      hub.broadcast(sessionId, { type: "collaboration_update", payload: { status: "error", mode, message: String(error) } });
    });
    return;
  }

  // ── user_response（ask_user 应答）──
  if (msgType === "user_response") {
    void callRpcStrict(hub, sessionId, "user_response", { session_id: sessionId, ...payload }, "应答");
    return;
  }

  // ── update_auto_approve ──
  if (msgType === "update_auto_approve") {
    const autoApprove = Boolean(payload.auto_approve);
    void callRpcStrict(hub, sessionId, "set_auto_approve", { session_id: sessionId, auto_approve: autoApprove }, "自动执行开关");
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
    void callRpcStrict(hub, sessionId, "plan_action", planPayload, "计划操作");
    return;
  }

  // ── set_plan_mode ──
  if (msgType === "set_plan_mode") {
    void callRpcStrict(hub, sessionId, "set_plan_mode", { session_id: sessionId, enabled: Boolean(payload.enabled) }, "计划模式");
    return;
  }

  // ── checkpoint_action ──
  if (msgType === "checkpoint_action") {
    const checkpointPayload: Record<string, unknown> = {
      session_id: sessionId,
      action: String(payload.action ?? ""),
    };
    if (payload.goal) checkpointPayload.goal = payload.goal;
    void callRpcStrict(hub, sessionId, "checkpoint_action", checkpointPayload, "检查点操作");
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
    taskReviewStates.delete(sessionId);

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
      priceStatus: "unknown",
      cacheStatus: "unknown",
      modelUsageRequests: [],
      requestCount: 0,
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
          // 插件提供的渠道**不在 providers.yaml 里**（凭据与端点在插件自己的适配器里），
          // 所以「查不到就报错」会把插件模型整条链路挡在门外
          //（pi 侧其实已经能解析 —— 见 kernel/model.ts 的 registerPluginProviderOn）。
          const pluginProvided = !provider && isPluginProvider(providerId);
          if (!provider && !pluginProvided) {
            throw new Error(`所选提供商不可用：${providerId}`);
          }
          if (provider && provider.enabled === false) {
            throw new Error(`所选提供商不可用：${providerId}`);
          }
          const resolved = await resolvePiModel(
            {
              model: modelName,
              provider: providerId,
              // 插件渠道没有 base_url / api_key / provider_type 可传：
              // 这些都由插件适配器自己决定，传空值反而会覆盖它的配置。
              ...(provider
                ? {
                    baseUrl: typeof provider.base_url === "string" ? provider.base_url : undefined,
                    apiKey: decryptProviderKey(provider.api_key),
                    providerType: typeof provider.provider_type === "string" ? provider.provider_type : undefined,
                    contextWindow: Number(provider.context_window) || undefined,
                  }
                : {}),
              maxTokens: Number(payload.max_tokens) || undefined,
            },
            record?.session.modelRuntime,
          );
          if (!record) throw new Error(`会话不存在：${sessionId}`);
          selectedModel = resolved.model;
          record.modelPriceStatus = resolved.priceStatus;
          record.modelCacheStatus = resolved.cacheStatus;
          const activeTurn = turnStates.get(sessionId);
          if (activeTurn?.turnId === turnId) {
            activeTurn.priceStatus = resolved.priceStatus;
            activeTurn.cacheStatus = resolved.cacheStatus;
          }
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
        const enrichedMessage = enrichWithEvolutionContext(userMessage, sessionId, turnId);
        return hub.callRpc("prompt", {
          session_id: sessionId,
          message: enrichedMessage,
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
