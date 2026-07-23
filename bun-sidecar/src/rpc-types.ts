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
  | "get_messages"
  | "user_response";

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

export interface UserResponseParams {
  session_id: string;
  interaction_id: string;
  response: string | string[];
}

export interface UserResponseResult {
  ok: true;
}

// ---------------------------------------------------------------------------
// Events — Maxma 前端 WS 协议格式
// ---------------------------------------------------------------------------

/** Sidecar 可推送的全部事件类型（由 mapPiEventToMaxma 映射产生）

注：独立 `context_usage` 事件不在联合中 —— sidecar 从未发射独立 context_usage，
用量只通过 done.payload.context_usage 内嵌送达前端（后端 chat.py 计算）。 */
export type MaxmaEvent =
  // A6: payload 与 session-bridge.ts 实发对齐（此前声明 {timestamp:number} 与实发 {} 不符）。
  | { type: "thinking_start"; payload: Record<string, never> }
  | { type: "token"; payload: { token: string } }
  | { type: "thinking_end"; payload: { content: string } }
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
      // cancelled: A1 —— chat.py cancel 路径补发 done 时置 true，闭合前端状态机。
      payload: {
        turn_id?: string;
        context_usage?: Record<string, unknown>;
        cancelled?: boolean;
      };
    }
  | {
      type: "error";
      // category: A2 —— chat.py 转发 sidecar error 时按 code 映射并补 trace_id，
      // 激活前端 ChatWindow 的 trace 显示与样式区分。
      payload: {
        code: string;
        message: string;
        trace_id?: string;
        category?: string;
      };
    }
  | { type: "context_usage"; payload: Record<string, unknown> }
  // A3: auto_compaction_end → context_compressed。前端已有处理逻辑（用量更新 +
  // 系统通知），此前无发射端。CompactionResult 无 after_tokens/removed_count，
  // 前端已防御 undefined。
  | {
      type: "context_compressed";
      payload: {
        summary_preview?: string;
        before_tokens?: number;
        action?: string;
        skipped?: boolean;
        aborted?: boolean;
      };
    }
  | {
      type: "ask_user";
      // B3: risk_level / tool_input 声明 optional 但 sidecar 实际无法填充 ——
      // OMP approval wrapper 调 ctx.select(formatApprovalPrompt(tool,args,reason), ...)
      // 仅传格式化 title 字符串，sidecar 拿不到结构化 tool_input/risk_level。
      // 前端 ApprovalBubble 需对 undefined 降级（已 fallback）。保留字段以备
      // OMP 暴露结构化审批上下文后直接填充。
      payload: {
        tool_name: string;
        question: string;
        mode: "approval";
        options: string[];
        interaction_id: string;
        detail?: string;
        risk_level?: "low" | "medium" | "high";
        tool_input?: Record<string, unknown>;
      };
    };
