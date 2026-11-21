/**
 * kernel/approval-gate.ts — Maxma 审批门（阶段一 §6.2 任务 2）。
 *
 * 对接官方 tool_call 钩子（extensions/maxma-approval.ts）与前端的
 * ask_user WS 事件 / user_response RPC。取代 OMP 时代的
 * ExtensionUIContext ctx.select 标题字符串方案：
 *   - 不再需要 parseApprovalTitle 反解析（toolName/input 结构化直达）；
 *   - 超时默认拒绝语义沿用（state.ts APPROVAL_TIMEOUT_MS）。
 */

import type {
  ApprovalDecision,
  ApprovalGate,
  ApprovalRequest,
  MaxmaPermissionMode,
  PermissionDecision,
} from "./types";
import type { MaxmaEventLike } from "./events";

/** 官方 Tool.annotations 的读取形状。 */
type Annotations = Record<string, unknown> | undefined;

/** gate 完整接口：ApprovalGate + RPC 兑现/清理入口（bridge 层调用）。 */
export interface MaxmaApprovalGate extends ApprovalGate {
  /** user_response RPC 到达：兑现对应 ask_user。返回是否命中在途审批。 */
  resolveUserApproval(interactionId: string, response: string | string[]): boolean;
  /** 在途审批数（health/调试用）。 */
  pendingCount(): number;
  /** 会话销毁时拒绝全部在途审批，防止 promise 泄漏挂住 tool_call 钩子。 */
  rejectAll(reason?: string): void;
  /** 切到自动执行时放行全部在途审批（否则那些卡永远等不到答复）。 */
  approveAllPending(): number;
}

export interface CreateMaxmaApprovalGateDeps {
  /** 发射 ask_user 事件（bridge 绑定 session_id 后传入）。 */
  emit: (event: MaxmaEventLike) => void;
  /** 当前权限模式（运行时可被 set_auto_approve 切换）。 */
  mode: () => MaxmaPermissionMode;
  /** 审批超时（默认 5 分钟，语义同 state.ts APPROVAL_TIMEOUT_MS）。 */
  timeoutMs?: number;
}

/** 是否属于“执行类”工具：官方 destructiveHint 或 bash/powershell 工具族。 */
function isExecuteFamily(toolName: string, annotations: Annotations): boolean {
  const name = toolName.toLowerCase();
  return name === "bash" || name === "powershell" || annotations?.destructiveHint === true;
}

/**
 * 四档权限矩阵（纯函数，单一判据）。
 *
 *   read_only：只读放行，写入/执行一律 deny（不是 ask：用户不能把“只读”逐次批准成写入）；
 *   ask      ：只读放行，其余逐次 ask；
 *   operate  ：只读与写入放行，执行类 ask；
 *   auto     ：全部 allow，但仍受 PathPolicy / 命令守卫 / MaxmaBlocker 约束。
 *
 * 判据只看官方注解和工具名族，不猜工具语义。未知档位一律 deny（fail-closed）。
 */
export function permissionDecisionForMode(
  mode: MaxmaPermissionMode,
  toolName: string,
  annotations: Annotations,
): PermissionDecision {
  if (mode === "auto") return "allow";
  const readOnly = annotations?.readOnlyHint === true;
  if (mode === "read_only") return readOnly ? "allow" : "deny";
  if (mode === "ask") return readOnly ? "allow" : "ask";
  if (mode === "operate") return readOnly || !isExecuteFamily(toolName, annotations) ? "allow" : "ask";
  return "deny";
}

/**
 * 兼容旧调用点的二值投影：仅供“是否需要审批”使用。
 * 注意 deny 也返回 false——调用方必须先看 `permissionDecisionForMode`；
 * 审批扩展已经按三值判定，不会把 read_only 的拒绝误当放行。
 */
export function needsApprovalForMode(
  mode: MaxmaPermissionMode,
  toolName: string,
  annotations: Annotations,
): boolean {
  return permissionDecisionForMode(mode, toolName, annotations) === "ask";
}

/** 风险等级：官方注解结构化推导（取代 OMP 标题关键词启发式）。 */
function riskLevelOf(annotations: Annotations): "low" | "medium" | "high" {
  if (annotations?.destructiveHint === true) return "high";
  if (annotations?.readOnlyHint === true) return "low";
  return "medium";
}

interface PendingEntry {
  resolve: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createMaxmaApprovalGate(deps: CreateMaxmaApprovalGateDeps): MaxmaApprovalGate {
  const pending = new Map<string, PendingEntry>();
  const timeoutMs = deps.timeoutMs ?? 5 * 60 * 1000;

  const gate: MaxmaApprovalGate = {
    decision({ toolName, annotations }) {
      return permissionDecisionForMode(deps.mode(), toolName, annotations);
    },

    needsApproval({ toolName, annotations }) {
      return needsApprovalForMode(deps.mode(), toolName, annotations);
    },

    decide(req) {
      return new Promise<ApprovalDecision>((resolve) => {
        const interactionId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `ia-${Date.now()}-${Math.random().toString(16).slice(2)}`;

        const entry: PendingEntry = {
          resolve,
          timer: setTimeout(() => {
            pending.delete(interactionId);
            // 超时默认拒绝（沿用 OMP 版 APPROVAL_TIMEOUT 语义）
            resolve({ approved: false, reason: "approval timeout" });
          }, timeoutMs),
        };
        pending.set(interactionId, entry);

        deps.emit({
          type: "ask_user",
          payload: {
            tool_name: req.toolName,
            // 与 tool_start 同一个 id：前端把审批卡挂到那一次调用上，而不是只按工具名。
            tool_call_id: req.toolCallId,
            question: `允许调用 ${req.toolName}？`,
            mode: "approval",
            options: ["Approve", "Deny"],
            interaction_id: interactionId,
            risk_level: riskLevelOf(req.annotations),
            tool_input: req.input,
          },
        });
      });
    },

    resolveUserApproval(interactionId, response) {
      const entry = pending.get(interactionId);
      if (!entry) return false;
      clearTimeout(entry.timer);
      pending.delete(interactionId);
      // 与 OMP 版 resolveUserResponse 同语义：前端 "yes" → 批准，其余拒绝
      const approved = response === "yes";
      entry.resolve({ approved, reason: approved ? undefined : "denied by user" });
      return true;
    },

    pendingCount() {
      return pending.size;
    },

    rejectAll(reason = "session destroyed") {
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.resolve({ approved: false, reason });
      }
      pending.clear();
    },

    approveAllPending() {
      const count = pending.size;
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.resolve({ approved: true });
      }
      pending.clear();
      return count;
    },
  };

  return gate;
}
