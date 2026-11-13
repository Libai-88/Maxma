/**
 * rpc-types.ts — JSON-RPC 2.0 协议类型定义（Python ↔ Bun sidecar）。
 *
 * 本文件定义 sidecar 通信协议的全部类型。核心 RPC 方法由
 * session-bridge.ts 实现，事件映射遵循 Maxma 前端 WS 协议格式。
 */

// 事件 payload 的取值域**不在本文件维护**：唯一来源是 `kernel/pi-contract.ts`
// （Maxma 引擎消费面单源清单）。本文件只允许"派生"，重抄一份字面量就会与引擎现实漂移。
import { MAXMA_COMPACTION_ACTION_WS, MAXMA_COMPACTION_REASONS_WS } from "./kernel/pi-contract";
import type { MaxmaPermissionMode } from "./kernel/pi-contract";

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
  | "user_response"
  | "extension_ui_response"
  | "get_settings"
  | "set_settings"
  | "get_health"
  | "reload_mcp"
  | "compact"
  | "get_discovered_mcp"
  | "get_discovered_skills"
  | "get_discovered_extensions"
  | "list_plugins"
  | "install_plugin"
  | "uninstall_plugin"
  | "set_plugin_enabled"
  | "get_plugin_detail"
  | "get_plugin_config"
  | "update_plugin_config"
  | "headless_prompt"
  | "set_auto_approve"
  | "reload_mcp_for_session"
  | "plan_action"
  // TREE-001..004：会话树 / 树内导航 / 分叉 / 重命名与统计导出
  | "get_tree"
  | "navigate_tree"
  | "fork_session"
  | "set_session_name"
  | "get_session_stats"
  | "list_prompt_templates"
  | "get_session_state"
  | "context_edit"
  | "reload_session_resources"
  | "export_session_html";

export interface CreateSessionParams {
  model: string;
  system_prompt?: string;
  append_system_prompt?: string;
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
// Settings RPC — OMP Settings 读写
// ---------------------------------------------------------------------------

export interface GetSettingsParams {
  session_id?: string;
  paths?: string[];
}

export interface GetSettingsResult {
  settings: Record<string, unknown>;
}

export interface SetSettingsParams {
  session_id?: string;
  path: string;
  value: unknown;
}

export interface SetSettingsResult {
  ok: true;
}

// ---------------------------------------------------------------------------
// Events — Maxma 前端 WS 协议格式
// ---------------------------------------------------------------------------

/**
 * `context_compressing.payload.reason` 的取值域——**从 `pi-contract.ts` 派生**，
 * 不是第二份字面量清单。引擎新增一个 reason 时，只需要改 `MAXMA_COMPACTION_REASONS_WS`
 * 一处，本类型与 `web` 的 `CompactionReason` 会由测试逼着一起跟上。
 */
export type MaxmaCompactionReason = (typeof MAXMA_COMPACTION_REASONS_WS)[number];

/**
 * `context_compressing.payload.action` 的取值域。
 *
 * 引擎真实值**派生自** `MAXMA_COMPACTION_ACTION_WS`（pi 路径恒发 `context-full`），
 * 后面三个是上一代引擎（OMP）遗留值：当前引擎不产出，保留给历史转录回放与前端既有
 * 分支（与 `web/src/types/index.ts` 的 `CompactionAction` 逐字一致，由
 * `bun-sidecar/tests/engine-boundary.test.ts` 对账）。遗留值只能显式写在这里——
 * 契约清单里没有它们，整体派生会把契约域悄悄收窄。
 */
export type MaxmaCompactionAction =
  | (typeof MAXMA_COMPACTION_ACTION_WS)[number]
  | "handoff"
  | "shake"
  | "snapcompact";

/** Sidecar 可推送的全部事件类型（由 mapPiEventToMaxma 映射产生）

注：独立 `context_usage` 事件不在联合中 —— sidecar 从未发射独立 context_usage，
用量只通过 done.payload.context_usage 内嵌送达前端（后端 chat.py 计算）。 */
export type MaxmaEvent =
  // A6: payload 与 session-bridge.ts 实发对齐（此前声明 {timestamp:number} 与实发 {} 不符）。
  | { type: "thinking_start"; payload: Record<string, never> }
  | { type: "token"; payload: { token: string } }
  | { type: "thinking_delta"; payload: { delta: string } }
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
  | {
      type: "tool_update";
      payload: {
        tool_name: string;
        partial_result: string;
      };
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
  // PLAN-BRIDGE-001：计划模式审批事件（plan-bridge.ts 发射）。plan_proposed
  // 携带 agent 提交的全部计划文本与步骤摘要，前端 PlanCard 渲染审批；
  // plan_completed 在用户批准后发射，卡片切换到执行态。
  | {
      type: "plan_proposed";
      payload: {
        plan_id: string;
        steps: string[];
        plan_text: string;
      };
    }
  | {
      type: "plan_completed";
      payload: { summary: { total_steps: number } };
    }
  // GAP-B1-001：目标模式状态事件（events.ts 映射发射；chat.py 需订阅转发，
  // 否则 agent 自主变更目标时前端收不到）。
  | {
      type: "goal_updated";
      payload: {
        goal: Record<string, unknown> | null;
        state: Record<string, unknown> | null;
      };
    }
  // A3: auto_compaction_end → context_compressed。前端已有处理逻辑（用量更新 +
  // 系统通知），此前无发射端。CompactionResult 无 after_tokens/removed_count，
  // 前端已防御 undefined。willRetry/error_message 来自 OMP AutoCompactionEndEvent，
  // 告知前端是否即将重试。
  | {
      type: "context_compressed";
      payload: {
        summary_preview?: string;
        before_tokens?: number;
        action?: string;
        skipped?: boolean;
        aborted?: boolean;
        will_retry?: boolean;
        error_message?: string;
      };
    }
  // `reason` 的取值域整个**派生自 `pi-contract.ts`**，`action` 的引擎真实值派生、上一代遗留值显式（见上面的别名注释）。
  // 重抄过一次真事故：`MaxmaEvent` 的 reason 联合漏了 pi 会发的 `manual`，于是
  // "用户手动压缩"在 UI 上被静默误报成"阈值触发"（详见 docs/contracts/ws-events.md
  // §3.1）。类型 ↔ 清单 ↔ 前端联合三者的双向锁由
  // `bun-sidecar/tests/engine-boundary.test.ts` 承担。
  | {
      type: "context_compressing";
      payload: {
        reason: MaxmaCompactionReason;
        action: MaxmaCompactionAction;
      };
    }
  | {
      type: "ask_user";
      // B3 已修复：sidecar 现在通过 parseApprovalTitle 从格式化 title 中解析
      // risk_level 和 tool_input。保留 optional 以兼容 OMP 未来结构化审批上下文。
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
    }
  // OMP auto-retry events
  | {
      type: "retry_start";
      payload: {
        attempt: number;
        max_attempts: number;
        delay_ms: number;
        error_message: string;
      };
    }
  | {
      type: "retry_end";
      payload: {
        success: boolean;
        attempt: number;
        final_error?: string;
      };
    }
  // OMP todo reminder
  | {
      type: "todo_reminder";
      payload: {
        todos: Array<{ content: string; status: string }>;
        attempt: number;
        max_attempts: number;
      };
    }
  // OMP IRC multi-agent message
  | {
      type: "irc_message";
      payload: {
        from: string;
        to: string;
        body: string;
        id: string;
      };
    }
  // OMP notice (info/warning/error)
  | {
      type: "notice";
      payload: {
        level: "info" | "warning" | "error";
        message: string;
        source?: string;
      };
    }
  // PERM-ANNOUNCE-001：`record.permissionMode` 的两个写入方（set_permission_mode 四档 /
  // set_auto_approve 两态）每次写入都广播这一条，前端权限选择器与「自动执行」开关据此
  // 收敛。取值域派生自 `pi-contract.ts` 的 MAXMA_PERMISSION_MODES，不在这里重抄字面量。
  | {
      type: "permission_mode_updated";
      payload: { permission_mode: MaxmaPermissionMode };
    };
