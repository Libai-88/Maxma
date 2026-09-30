/**
 * kernel/approval-gate.ts — Maxma 审批门（阶段一 §6.2 任务 2）。
 *
 * 对接官方 tool_call 钩子（extensions/maxma-approval.ts）与前端的
 * ask_user WS 事件 / user_response RPC。取代 OMP 时代的
 * ExtensionUIContext ctx.select 标题字符串方案：
 *   - 不再需要 parseApprovalTitle 反解析（toolName/input 结构化直达）；
 *   - 超时默认拒绝语义沿用（state.ts APPROVAL_TIMEOUT_MS）。
 */

import type { ApprovalDecision, ApprovalGate, ApprovalRequest, MaxmaPermissionMode } from "./types";
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
}

export interface CreateMaxmaApprovalGateDeps {
  /** 发射 ask_user 事件（bridge 绑定 session_id 后传入）。 */
  emit: (event: MaxmaEventLike) => void;
  /** 当前权限模式（运行时可被 set_auto_approve 切换）。 */
  mode: () => MaxmaPermissionMode;
  /** 审批超时（默认 5 分钟，语义同 state.ts APPROVAL_TIMEOUT_MS）。 */
  timeoutMs?: number;
}

/**
 * 权限模式 + 官方注解 → 是否需要审批：
 *   read_only / ask → 非只读工具逐次审批
 *   operate         → 仅执行类（官方 destructiveHint / bash·PowerShell 工具族）审批
 *   auto            → 全部放行（gate 本就不装配，此处兜底）
 */
export function needsApprovalForMode(
  mode: MaxmaPermissionMode,
  toolName: string,
  annotations: Annotations,
): boolean {
  if (mode === "auto") return false;
  const readOnly = annotations?.readOnlyHint === true;
  if (mode === "read_only" || mode === "ask") return !readOnly;
  if (mode === "operate") {
    const name = toolName.toLowerCase();
    const executeFamily = name === "bash" || name === "powershell" || annotations?.destructiveHint === true;
    return executeFamily;
  }
  return true;
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
  };

  return gate;
}
