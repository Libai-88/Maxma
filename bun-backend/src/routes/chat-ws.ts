/**
 * routes/chat-ws.ts — 对话 WebSocket 层（api/routes/chat.py websocket_chat 的
 * Bun 直译，阶段二 2.3）。
 *
 * 架构：Bun.serve websocket handler（upgrade 鉴权在 server.ts，X-Maxma-Token
 * 或 WS subprotocol）+ kernel in-process 直调。事件流：kernel io.sendEvent →
 * wsRegistry 广播（session → Set<ServerWebSocket>，MULTI-WS-001 多窗口同播）。
 *
 * 契约保留（api/ws_protocol.py + docs/contracts/ws-events.md）：
 *   - server 首帧 hello {protocol_version:1}
 *   - client 消息白名单（ping/chat/cancel/user_response/plan_response/
 *     update_auto_approve/set_plan_mode/checkpoint_action/goal_action/
 *     artifact_action），未知类型静默丢弃
 *   - IDEMPOTENCY-001 client_msg_id 幂等去重（turn 成功后记录）
 *   - CONN-MUTEX-001 同会话单连接持有 turn（其他连接发 chat → BUSY error）
 *   - AG-CONTEXT-001 断开不销毁会话（重连复用）
 *   - role/事件形状逐字段对齐（kernel mapPiAgentEventToMaxma 已产出 Maxma 事件）
 */

import type { ServerWebSocket } from "bun";
import * as crypto from "node:crypto";

import type { PiPendingPlan, PiSessionRecord } from "../../../bun-sidecar/src/kernel/bridge-pi";

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
]);

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
  /** 向指定会话广播事件（kernel sendEvent 的 WS 出口）。 */
  broadcast: (sessionId: string, event: { type: string; payload?: unknown }) => void;
}

export interface WsData {
  sessionId: string;
}

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

/** 注销连接（AG-CONTEXT-001：不销毁会话）。 */
export function unregisterChatConnection(hub: ChatWsHub, sessionId: string, ws: ServerWebSocket<WsData>): void {
  const set = hub.connections.get(sessionId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) hub.connections.delete(sessionId);
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
    if (record) {
      void hub
        .callRpc("cancel", { session_id: sessionId })
        .then(() => {
          // AG-IDEMPOTENCY-001 的幂等补发在 kernel cancel 路径内处理
        })
        .catch(() => {});
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

    // CONN-MUTEX-001：运行中拒绝新 turn（kernel currentGuard 非空 = in-flight）
    if (record?.currentGuard) {
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

    // 会话不存在时自动创建（Python 版 get_or_create 同语义）
    void hub
      .callRpc("prompt", {
        session_id: sessionId,
        message: userMessage,
        // THINKING-WIRE-001：thinking 两态（bool→high/off；str 直接透传）
        ...(typeof payload.thinking === "string" && payload.thinking
          ? { thinking_level: payload.thinking }
          : typeof payload.thinking === "boolean"
            ? { thinking_level: payload.thinking ? "high" : "off" }
            : {}),
        ...(payload.model_name ? { model: payload.model_name } : {}),
        ...(payload.provider_id ? { provider: payload.provider_id } : {}),
        ...(typeof payload.temperature === "number" && payload.temperature >= -1 && payload.temperature <= 2
          ? { temperature: payload.temperature }
          : {}),
        ...(typeof payload.max_tokens === "number" && payload.max_tokens > 0 && payload.max_tokens <= 65536
          ? { max_tokens: Math.floor(payload.max_tokens) }
          : {}),
      })
      .then((result) => {
        if (!result.ok) {
          hub.broadcast(sessionId, {
            type: "error",
            payload: { message: result.error, category: "system_error" },
          });
          return;
        }
        // turn 成功：记录幂等 id（IDEMPOTENCY-001：成功后记录）
        if (typeof clientMsgId === "string" && clientMsgId) {
          const ids = hub.seenClientMsgIds.get(sessionId) ?? [];
          ids.push(clientMsgId);
          hub.seenClientMsgIds.set(sessionId, ids);
        }
      })
      .catch((err) => {
        hub.broadcast(sessionId, {
          type: "error",
          payload: { message: String(err), category: "system_error" },
        });
      });
    return;
  }
}
