/**
 * plan-bridge.ts — OMP 计划模式 ↔ Maxma 前端审批桥接。
 *
 * PLAN-BRIDGE-001：OMP 16.x 的计划模式审批不走 subscribe 事件流，而是由
 * agent 调用隐藏的 `resolve` 工具提交计划；resolve 在无排队 invoker 时回退到
 * `standingResolveHandler`（interactive CLI 用它弹审批框）。sidecar 此前只调
 * setPlanModeState 注册了计划态，从未注册 standing handler → 模型提交计划时
 * resolve 抛 "No pending action to resolve"，plan_proposed 等事件三层契约
 * （ws_protocol 枚举 / chat.py 订阅 / 前端 PlanCard）齐全但源头无发射端。
 *
 * 本模块在 set_plan_mode 启用时安装 handler：
 *   apply → 读计划文件（local:// 协议解析）→ 发 plan_proposed →
 *   等前端 plan_action RPC 回执（5 分钟超时按拒绝）→
 *   批准 = 退出计划态 + 注入执行指令 + 发 plan_completed；
 *   拒绝 = 返回拒绝文本，agent 留在计划模式继续修订。
 * OMP 内部类型/路径的断言集中在本文件（与 omp-compat.ts 同一纪律）。
 */
import { readdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveApprovedPlan } from "@oh-my-pi/pi-coding-agent/plan-mode/approved-plan";
import { resolveLocalUrlToPath } from "@oh-my-pi/pi-coding-agent/internal-urls";
import { normalizeLocalScheme } from "@oh-my-pi/pi-coding-agent/tools/path-utils";
import type { MaxmaEvent } from "./rpc-types";
import type { BridgeIo } from "./rpc";
import { PLAN_APPROVAL_TIMEOUT_MS, type PendingPlan, type PlanDecision } from "./state";

/** handler 安装目标会话的最小结构（AgentSession 的宽类型在 omp 侧演进）。 */
export interface PlanCapableSession {
  getPlanModeState?(): { enabled?: boolean; planFilePath?: string } | undefined;
  setPlanModeState?(state: unknown): void;
  setStandingResolveHandler?(
    handler: ((input: unknown) => Promise<unknown> | unknown) | null,
  ): void;
  getActiveToolNames?(): string[];
  setActiveToolsByName?(names: string[]): Promise<void>;
  agent?: { appendMessage?: (msg: unknown) => void };
  sessionManager?: {
    getArtifactsDir?(): string | undefined;
    getSessionId?(): string | undefined;
    getCwd?(): string;
  };
}

export interface PlanBridgeDeps {
  sendEvent: BridgeIo["sendEvent"];
  pendingPlans: Map<string, PendingPlan>;
  setTimeoutFn: typeof setTimeout;
  clearTimeoutFn: typeof clearTimeout;
  uuidFn: () => string;
  timeoutMs?: number;
}

/** 从计划 Markdown 提取顶层列表项作为步骤摘要（最多 12 条）。 */
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

function isEnoent(error: unknown): boolean {
  return (error as { code?: string })?.code === "ENOENT";
}

/**
 * 安装计划审批 handler。返回的 handler 由 OMP resolve 工具在 agent 提交
 * 计划（action=apply）时调用；decision 由 plan_action RPC 经 pendingPlans
 * 兑现。重复调用安全（覆盖旧 handler）。
 */
export function installPlanApprovalHandler(
  sessionId: string,
  session: PlanCapableSession,
  deps: PlanBridgeDeps,
): void {
  const {
    sendEvent,
    pendingPlans,
    setTimeoutFn,
    clearTimeoutFn,
    uuidFn,
    timeoutMs = PLAN_APPROVAL_TIMEOUT_MS,
  } = deps;

  const localOptions = {
    getArtifactsDir: () => session.sessionManager?.getArtifactsDir?.() ?? null,
    getSessionId: () => session.sessionManager?.getSessionId?.() ?? null,
  };

  const readPlan = async (url: string): Promise<string | null> => {
    try {
      const normalized = normalizeLocalScheme(url);
      const filePath = resolveLocalUrlToPath(normalized, localOptions);
      return await readFile(filePath, "utf8");
    } catch (error) {
      if (isEnoent(error)) return null;
      throw error;
    }
  };

  const listPlanFiles = async (): Promise<string[]> => {
    try {
      const root = resolveLocalUrlToPath("local://", localOptions);
      const names = readdirSync(root)
        .filter((n) => /plan\.md$/i.test(n))
        .map((n) => ({ n, mtime: statSync(join(root, n)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 10);
      return names.map((x) => `local://${x.n}`);
    } catch {
      return [];
    }
  };

  const exitPlanMode = async () => {
    session.setPlanModeState?.(undefined);
    session.setStandingResolveHandler?.(null);
  };

  const handler = async (input: unknown): Promise<unknown> => {
    const params = (input ?? {}) as {
      action?: string;
      reason?: string;
      extra?: { title?: unknown };
    };

    // agent 主动撤回提案：无需审批，直接确认。
    if (params.action !== "apply") {
      return {
        content: [{ type: "text", text: "Plan proposal discarded." }],
        details: {},
      };
    }

    const state = session.getPlanModeState?.();
    if (!state?.enabled) {
      return {
        content: [{ type: "text", text: "Plan mode is not active." }],
        details: {},
      };
    }

    let resolved: { planFilePath: string; planContent: string; title: string };
    try {
      resolved = await resolveApprovedPlan({
        suppliedTitle: params.extra?.title,
        statePlanFilePath: state.planFilePath || "local://PLAN.md",
        readPlan,
        listPlanFiles,
      });
    } catch (error) {
      // 计划文件缺失等：以工具错误返回给模型（可重试写计划），不弹审批。
      return {
        content: [
          {
            type: "text",
            text: `Plan approval failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        details: {},
      };
    }

    const planId = uuidFn();
    const steps = parsePlanSteps(resolved.planContent);
    const event: MaxmaEvent = {
      type: "plan_proposed",
      payload: {
        plan_id: planId,
        steps,
        plan_text: resolved.planContent,
      },
    };
    sendEvent(sessionId, event);

    let timer: ReturnType<typeof setTimeoutFn>;
    const decision = await new Promise<PlanDecision>((resolve) => {
      timer = setTimeoutFn(() => {
        if (pendingPlans.has(planId)) {
          pendingPlans.delete(planId);
          // 超时按拒绝（与工具审批 deny-by-default 一致）。
          resolve({ action: "reject", reason: "approval timeout" });
        }
      }, timeoutMs);
      pendingPlans.set(planId, { resolve, timer, sessionId });
    });
    clearTimeoutFn(timer!);

    if (decision.action === "approve" || decision.action === "modify") {
      await exitPlanMode();
      const planBody =
        decision.action === "modify" && decision.modifiedPlan
          ? `${resolved.planContent}\n\n[User modifications]\n${decision.modifiedPlan}`
          : resolved.planContent;
      session.agent?.appendMessage?.({
        role: "user",
        content: `[Plan Approved]\nThe following plan has been approved by the user. Execute it step by step:\n\n${planBody}`,
        timestamp: Date.now(),
      });
      sendEvent(sessionId, {
        type: "plan_completed",
        payload: { summary: { total_steps: Math.max(steps.length, 1) } },
      });
      return {
        content: [{ type: "text", text: "Plan approved by the user. Execute it now." }],
        details: { planFilePath: resolved.planFilePath, title: resolved.title, planExists: true },
      };
    }

    // 拒绝：留在计划模式，模型修订后再次提交。
    session.agent?.appendMessage?.({
      role: "user",
      content: "[Plan Rejected]\nThe proposed plan has been rejected by the user. Please revise your approach.",
      timestamp: Date.now(),
    });
    return {
      content: [{ type: "text", text: "Plan rejected by the user. Revise and re-propose." }],
      details: {},
    };
  };

  session.setStandingResolveHandler?.(handler);
}

/** 拒绝/清理指定会话的全部在途计划审批（destroy_session / 关闭计划模式时调用）。 */
export function rejectPendingPlansForSession(
  pendingPlans: Map<string, PendingPlan>,
  sessionId: string,
  clearTimeoutFn: typeof clearTimeout,
): void {
  for (const [planId, pending] of [...pendingPlans.entries()]) {
    if (pending.sessionId !== sessionId) continue;
    pendingPlans.delete(planId);
    clearTimeoutFn(pending.timer);
    pending.resolve({ action: "reject", reason: "session closed" });
  }
}
