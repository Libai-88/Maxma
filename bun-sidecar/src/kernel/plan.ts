/**
 * kernel/plan.ts — Maxma 计划模式的 pi 自建（阶段一 §6.2 任务 4）。
 *
 * pi 无计划模式运行时（官方扩展事件里无 plan 概念，spike 已确认），按方案
 * 用官方机制自建，语义对齐 OMP 版 plan-bridge（PLAN-BRIDGE-001）：
 *   - set_plan_mode(enabled) → followUp 注入计划模式指令（官方排队语义，
 *     下轮随用户消息到达）
 *   - agent 写好计划后调用 Maxma 注册的 `submit_plan` 官方自定义工具提交审批
 *     （取代 OMP 内部 resolve 工具 + standing handler——零引擎内部依赖）
 *   - 工具 execute：发 plan_proposed（契约 payload 不变）→ 等待 plan_action
 *     RPC 回执（10 分钟超时按拒绝，与工具审批 deny-by-default 一致）→
 *     批准 = 退出计划态 + 发 plan_completed + 工具结果携带执行指令与计划全文
 *     （工具结果进入模型上下文，官方路径，无需 appendMessage）；拒绝 = 回因，
 *     agent 留在计划模式修订
 */

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { MaxmaEventLike } from "./events";

/** 计划审批的在途条目（与 state.ts PendingPlan 同形状，plan_action RPC 兑现）。 */
export interface PiPendingPlan {
  resolve: (decision: PiPlanDecision) => void;
  timer: ReturnType<typeof setTimeout>;
  sessionId: string;
}

export interface PiPlanDecision {
  action: "approve" | "reject" | "modify";
  modifiedPlan?: string;
  reason?: string;
}

/** 计划审批超时——计划修订成本高，给 10 分钟（同 state.ts PLAN_APPROVAL_TIMEOUT_MS）。 */
export const PI_PLAN_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

/** set_plan_mode(enabled=true) 时注入的官方排队指令（随下一轮用户消息到达）。 */
export const PI_PLAN_MODE_DIRECTIVE = [
  "[计划模式]",
  "当前处于计划模式：请先探索并理解任务，然后把完整实施计划作为 plan_markdown 参数",
  "调用 submit_plan 工具提交用户审批。计划获批之前，不要执行任何写操作或代码修改。",
  "计划被批准后，你会收到执行指令，届时再逐步执行。",
].join("\n");

/** 从计划 Markdown 提取顶层列表项作为步骤摘要（最多 12 条；与 OMP 版同算法）。 */
export function parsePlanSteps(planText: string): string[] {
  const steps: string[] = [];
  for (const line of planText.split(/\r?\n/)) {
    // 仅顶层（无缩进）列表项：`- x`、`* x`、`1. x`、`1) x`
    const m = /^(?:[-*]\s+|\d+[.)]\s+)(.+)$/.exec(line);
    if (m && m[1]) steps.push(m[1].trim());
    if (steps.length >= 12) break;
  }
  return steps;
}

export interface CreateSubmitPlanToolDeps {
  /** 归属会话 id（rejectPendingPiPlansForSession 按此清理）。 */
  sessionId: string;
  /** 是否处于计划模式（读 record.planMode）。 */
  isPlanMode: () => boolean;
  /** 审批通过/修改后退出计划模式（record.planMode = false）。 */
  onApproved: () => void;
  /** 发射 plan_proposed / plan_completed 事件（bridge 绑定 session_id）。 */
  emit: (event: MaxmaEventLike) => void;
  /** 在途审批登记表（plan_action RPC 兑现；与 OMP 路径共用 bridgeState.pendingPlans）。 */
  pendingPlans: Map<string, PiPendingPlan>;
  timeoutMs?: number;
  uuidFn?: () => string;
}

/**
 * submit_plan 官方自定义工具。readOnlyHint: true——提交提案本身无副作用，
 * 不应触发工具审批门（写操作发生在计划批准之后）。
 */
export function createSubmitPlanTool(deps: CreateSubmitPlanToolDeps): ToolDefinition {
  const timeoutMs = deps.timeoutMs ?? PI_PLAN_APPROVAL_TIMEOUT_MS;
  const uuidFn = deps.uuidFn ?? (() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `plan-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  return defineTool({
    name: "submit_plan",
    label: "提交计划",
    description:
      "计划模式下提交完整实施计划给用户审批。参数 plan_markdown 为完整计划（Markdown，含分步列表）。用户批准后你会收到执行指令；拒绝时请修订后重新提交。",
    parameters: Type.Unsafe({
      type: "object",
      properties: {
        plan_markdown: { type: "string", description: "完整实施计划（Markdown，含分步列表）" },
        title: { type: "string", description: "计划标题（可选）" },
      },
      required: ["plan_markdown"],
      additionalProperties: false,
    }) as ToolDefinition["parameters"],
    annotations: { readOnlyHint: true },
    async execute(toolCallId, params) {
      const planMarkdown = String((params as { plan_markdown?: unknown }).plan_markdown ?? "").trim();
      if (!planMarkdown) {
        return {
          content: [{ type: "text", text: "plan_markdown 为空，请提交完整计划。" }],
          details: {},
        };
      }
      if (!deps.isPlanMode()) {
        return {
          content: [{ type: "text", text: "Plan mode is not active." }],
          details: {},
        };
      }

      const planId = uuidFn();
      const steps = parsePlanSteps(planMarkdown);
      deps.emit({
        type: "plan_proposed",
        payload: { plan_id: planId, steps, plan_text: planMarkdown },
      });

      let timer: ReturnType<typeof setTimeout>;
      const decision = await new Promise<PiPlanDecision>((resolve) => {
        timer = setTimeout(() => {
          if (deps.pendingPlans.has(planId)) {
            deps.pendingPlans.delete(planId);
            resolve({ action: "reject", reason: "approval timeout" });
          }
        }, timeoutMs);
        deps.pendingPlans.set(planId, { resolve, timer, sessionId: deps.sessionId });
      });
      clearTimeout(timer);

      if (decision.action === "approve" || decision.action === "modify") {
        deps.onApproved();
        const planBody =
          decision.action === "modify" && decision.modifiedPlan
            ? `${planMarkdown}\n\n[User modifications]\n${decision.modifiedPlan}`
            : planMarkdown;
        deps.emit({
          type: "plan_completed",
          payload: { summary: { total_steps: Math.max(steps.length, 1) } },
        });
        return {
          content: [
            {
              type: "text",
              text: `[Plan Approved]\nThe following plan has been approved by the user. Execute it step by step:\n\n${planBody}`,
            },
          ],
          details: { approved: true },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: "Plan rejected by the user. Revise and re-propose.",
          },
        ],
        details: { approved: false, reason: decision.reason },
      };
    },
  }) as ToolDefinition;
}

/** plan_action RPC 到达：兑现对应在途计划。返回是否命中。 */
export function resolvePiPlanAction(
  pendingPlans: Map<string, PiPendingPlan>,
  planId: string,
  decision: PiPlanDecision,
  clearTimeoutFn: typeof clearTimeout = clearTimeout,
): boolean {
  const pending = pendingPlans.get(planId);
  if (!pending) return false;
  clearTimeoutFn(pending.timer);
  pendingPlans.delete(planId);
  pending.resolve(decision);
  return true;
}

/** 会话销毁时拒绝全部在途计划（防 promise 泄漏挂住 submit_plan）。 */
export function rejectPendingPiPlansForSession(
  pendingPlans: Map<string, PiPendingPlan>,
  sessionId: string,
  clearTimeoutFn: typeof clearTimeout = clearTimeout,
): void {
  for (const [planId, pending] of [...pendingPlans.entries()]) {
    if (pending.sessionId !== sessionId) continue;
    clearTimeoutFn(pending.timer);
    pendingPlans.delete(planId);
    pending.resolve({ action: "reject", reason: "session closed" });
  }
}
