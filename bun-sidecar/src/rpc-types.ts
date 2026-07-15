/**
 * rpc-types.ts — JSON-RPC 2.0 协议类型定义（Python ↔ Bun sidecar）。
 *
 * 本文件定义 sidecar 通信协议的全部类型。核心 RPC 方法由
 * session-bridge.ts 实现，事件映射遵循 Maxma 前端 WS 协议格式。
 */

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 Envelope
// ---------------------------------------------------------------------------

/** JSON-RPC 2.0 请求（Python → sidecar） */
export interface RpcRequest {
  jsonrpc: "2.0";
  method: string;
  id: number;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 响应（sidecar → Python） */
export interface RpcResponse {
  jsonrpc: "2.0";
  id: number | null;
  result?: unknown;
  error?: { message: string; data?: unknown };
}

/** JSON-RPC 2.0 通知 / 事件推送（sidecar → Python） */
export interface RpcNotification {
  jsonrpc: "2.0";
  method: "event";
  params: {
    session_id: string;
    event: MaxmaEvent;
  };
}

// ---------------------------------------------------------------------------
// RPC Methods — 参数 & 返回值
// ---------------------------------------------------------------------------

export type RpcMethodName =
  | "create_session"
  | "prompt"
  | "cancel"
  | "destroy_session"
  | "undo"
  | "get_messages";

export interface CreateSessionParams {
  model: string;
  system_prompt?: string;
  cwd?: string;
  tools?: string[];
}

export interface CreateSessionResult {
  session_id: string;
}

export interface PromptParams {
  session_id: string;
  message: string;
}

export interface PromptResult {
  ok: true;
}

export interface CancelParams {
  session_id: string;
}

export interface CancelResult {
  ok: true;
}

export interface DestroySessionParams {
  session_id: string;
}

export interface DestroySessionResult {
  ok: true;
}

export interface UndoParams {
  session_id: string;
  steps?: number;
}

export interface UndoResult {
  removed: number;
}

export interface GetMessagesParams {
  session_id: string;
  limit?: number;
}

export interface GetMessagesResult {
  messages: Array<{ role: string; content: string }>;
  total: number;
}

// ---------------------------------------------------------------------------
// Events — Maxma 前端 WS 协议格式
// ---------------------------------------------------------------------------

/** Sidecar 可推送的全部事件类型（由 mapPiEventToMaxma 映射产生） */
export type MaxmaEvent =
  | { type: "thinking_start"; payload: { timestamp: number } }
  | { type: "token"; payload: { token: string } }
  | { type: "thinking_end"; payload: { timestamp: number } }
  | { type: "tool_start"; payload: { tool_name: string; input: string } }
  | {
      type: "tool_end";
      payload: {
        tool_name: string;
        output: string;
        elapsed: number;
        tool_data?: Record<string, unknown>;
      };
    }
  | {
      type: "tool_error";
      payload: { tool_name: string; error: string; elapsed: number };
    }
  | { type: "answer"; payload: { content: string } }
  | {
      type: "done";
      payload: { turn_id?: string; context_usage?: Record<string, unknown> };
    }
  | {
      type: "error";
      payload: {
        code: string;
        message: string;
        trace_id?: string;
      };
    }
  | { type: "context_usage"; payload: Record<string, unknown> };
