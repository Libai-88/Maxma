/**
 * Cowork 任务运行器（M1）。
 *
 * 复用 pi kernel 的会话/RPC，不重写 Agent 内核：
 *   create_session(cowork=true) → set_plan_mode → prompt
 *   事件从本 runner 自己的 io.sendEvent 进入，写入任务事件表。
 *
 * 暂停/恢复：
 *   - pause：中止本轮 + 拒绝在途计划/工具审批，任务状态落 paused，checkpoint 写入 run。
 *   - resume：用同一个 session_id 恢复 pi 会话（进程重启则从磁盘会话恢复），
 *     把已完成步骤与 checkpoint 交给模型，只继续未完成部分。
 */

import {
  handlePiCreateSession,
  handlePiSessionRpc,
  type PiPendingPlan,
  type PiSessionRecord,
} from "../../../bun-sidecar/src/kernel/bridge-pi";
import { rejectPendingPiPlansForSession } from "../../../bun-sidecar/src/kernel/plan";
import { findPersistedSession } from "../../../bun-sidecar/src/kernel/session-catalog";
import {
  CoworkConflictError,
  CoworkStore,
} from "./cowork-store";
import type { CoworkTask } from "./cowork-store";
import { artifactFromToolResult } from "./cowork-artifacts";
import { buildCoworkPrompt, buildCoworkResumePrompt } from "./cowork-prompt";
import { resolveCoworkModelParams } from "./cowork-model";
import { finishCoworkRun } from "./cowork-run-finish";
import { asRecord, str, truncate } from "./cowork-utils";

const COWORK_TOOLS = [
  "read",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "read_office_file",
  "write_office_file",
  "edit_office_file",
  "cowork_update_steps",
  "submit_plan",
] as const;

/** 计划批准前只暴露只读工具与提交入口；写工具在批准后才激活。 */
const COWORK_PLAN_TOOLS = [
  "read",
  "grep",
  "find",
  "ls",
  "read_office_file",
  "cowork_update_steps",
  "submit_plan",
] as const;

const PLAN_APPROVAL_TTL_MS = 10 * 60 * 1000;
const TOOL_APPROVAL_TTL_MS = 5 * 60 * 1000;

interface ActiveSession {
  taskId: string;
  runId: string;
}

interface RpcReply {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface CoworkOrchestratorDeps {
  store: CoworkStore;
  sessions: Map<string, PiSessionRecord>;
  pendingPlans: Map<string, PiPendingPlan>;
}

export class CoworkOrchestrator {
  private readonly store: CoworkStore;
  private readonly sessions: Map<string, PiSessionRecord>;
  private readonly pendingPlans: Map<string, PiPendingPlan>;
  private readonly active = new Map<string, ActiveSession>();
  private readonly toolInputs = new Map<string, string>();
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor(deps: CoworkOrchestratorDeps) {
    this.store = deps.store;
    this.sessions = deps.sessions;
    this.pendingPlans = deps.pendingPlans;
    this.sweepTimer = setInterval(() => {
      try {
        for (const approval of this.store.expirePendingApprovals()) {
          this.onApprovalExpired(approval);
        }
      } catch {
        // 数据库关停/测试清理期间不因定时器抛错
      }
    }, 30_000);
    if (typeof this.sweepTimer.unref === "function") this.sweepTimer.unref();
  }

  stop(): void {
    clearInterval(this.sweepTimer);
  }

  get activeSessionCount(): number {
    return this.active.size;
  }

  private mapSession(sessionId: string, taskId: string, runId: string): void {
    this.active.set(sessionId, { taskId, runId });
  }

  private rememberSession(task: CoworkTask, runId: string): void {
    if (!task.session_id) throw new CoworkConflictError("任务没有 session_id，无法启动");
    this.mapSession(task.session_id, task.id, runId);
  }

  private rpcCreate(params: Record<string, unknown>, timeoutMs = 20_000): Promise<RpcReply> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (reply: RpcReply) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(reply);
      };
      const timer = setTimeout(() => finish({ ok: false, error: "create_session timeout" }), timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
      const io = {
        send: (_id: number | null, result: unknown) => finish({ ok: true, result }),
        sendError: (_id: number | null, message: string) => finish({ ok: false, error: message }),
        sendEvent: (sessionId: string, event: { type: string; payload: Record<string, unknown> }) => {
          this.handleEvent(sessionId, event);
        },
      };
      void handlePiCreateSession(
        { io, sessions: this.sessions, pendingPlans: this.pendingPlans },
        params,
        0,
      ).catch((err) => finish({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    });
  }

  private rpcSession(sessionId: string, method: string, params: Record<string, unknown>, timeoutMs = 15_000): Promise<RpcReply> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (reply: RpcReply) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(reply);
      };
      const timer = setTimeout(() => finish({ ok: false, error: `${method} timeout` }), timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
      const io = {
        send: (_id: number | null, result: unknown) => finish({ ok: true, result }),
        sendError: (_id: number | null, message: string) => finish({ ok: false, error: message }),
        sendEvent: (sid: string, event: { type: string; payload: Record<string, unknown> }) => {
          this.handleEvent(sid, event);
        },
      };
      void handlePiSessionRpc(
        { io, sessions: this.sessions, pendingPlans: this.pendingPlans },
        method,
        sessionId,
        params,
        0,
      ).catch((err) => finish({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    });
  }

  private modelParams(): Record<string, unknown> {
    return resolveCoworkModelParams();
  }

  private async ensureSession(task: CoworkTask, mode: "start" | "resume", planPhase: boolean): Promise<void> {
    if (!task.session_id) throw new CoworkConflictError("任务没有 session_id");
    const sessionId = task.session_id;
    const existing = this.sessions.has(sessionId);
    const persisted = mode === "resume" && !existing ? findPersistedSession(sessionId) : null;
    const resumeSessionId = mode === "resume" && (existing || persisted) ? sessionId : undefined;
    const params: Record<string, unknown> = {
      cwd: task.workspace_root,
      allowed_roots: [task.workspace_root, task.staging_root],
      write_roots: [task.staging_root],
      tools: [...COWORK_TOOLS],
      permission_mode: task.permission_mode,
      skills_enabled: false,
      subagent: { enabled: false },
      cowork: true,
      append_system_prompt: buildCoworkPrompt(task, {
        resume: mode === "resume",
      }),
      in_memory: false,
      ...this.modelParams(),
      ...(resumeSessionId ? { resume_session_id: resumeSessionId } : { session_id: sessionId }),
    };
    const reply = await this.rpcCreate(params);
    if (!reply.ok) throw new CoworkConflictError(reply.error ?? "创建 Cowork 会话失败");
    this.applyToolPhase(sessionId, planPhase);
    this.mapSession(sessionId, task.id, this.store.getLatestRun(task.id)?.id ?? "");
  }

  /** 直接切 Active Tools：计划期没有写工具，批准后再放开；不靠模型自觉。 */
  private applyToolPhase(sessionId: string, planPhase: boolean): void {
    const record = this.sessions.get(sessionId);
    record?.session.setActiveToolsByName(planPhase ? [...COWORK_PLAN_TOOLS] : [...COWORK_TOOLS]);
  }

  async startTask(taskId: string): Promise<{ task: CoworkTask; run_id: string }> {
    const task = this.store.getTask(taskId);
    if (!["draft", "failed", "cancelled", "completed"].includes(task.status)) {
      throw new CoworkConflictError(`当前状态 ${task.status} 不能启动新运行`);
    }
    const run = this.store.createRun(taskId, { freshSession: task.status !== "draft" });
    const next = this.store.transitionTask(taskId, "planning");
    this.rememberSession(next, run.id);
    this.store.appendEvent(taskId, run.id, "cowork.plan.requested", {
      message: "第一轮只提交计划，等待用户批准后再执行",
    });
    void this.launchPlan(next, run.id);
    return { task: next, run_id: run.id };
  }

  /**
   * 结构化选改：在任务已交付/已验收后，以已有产物 + 选区为输入开新一轮。
   * 不直接写文件；仍走 plan → 用户批准 → 执行，保持 M1 的审批链。
   */
  async reviseTask(taskId: string, input: {
    artifactId: string;
    path: string;
    kind: string;
    version: number;
    selection: Record<string, unknown>;
    instruction: string;
  }): Promise<{ task: CoworkTask; run_id: string }> {
    const task = this.store.getTask(taskId);
    if (!["review", "completed", "failed"].includes(task.status)) {
      throw new CoworkConflictError(`当前状态 ${task.status} 不能发起结构化选改`);
    }
    const run = this.store.createRun(taskId, { freshSession: true });
    const next = this.store.transitionTask(taskId, "planning");
    this.rememberSession(next, run.id);
    this.store.appendEvent(taskId, run.id, "cowork.revision.requested", {
      message: "已收到结构化选改，等待计划",
      artifact_id: input.artifactId,
      path: input.path,
      version: input.version,
      selection: input.selection,
      instruction: input.instruction,
    });
    void this.launchRevision(next, run.id, input);
    return { task: next, run_id: run.id };
  }

  private async launchRevision(
    task: CoworkTask,
    runId: string,
    input: {
      artifactId: string;
      path: string;
      kind: string;
      version: number;
      selection: Record<string, unknown>;
      instruction: string;
    },
  ): Promise<void> {
    try {
      await this.ensureSession(task, "start", true);
      const planReply = await this.rpcSession(task.session_id!, "set_plan_mode", { enabled: true });
      if (!planReply.ok) throw new Error(planReply.error ?? "set_plan_mode failed");
      const promptReply = await this.rpcSession(task.session_id!, "prompt", {
        message: [
          "这是一次结构化选改，不是重做整个任务。",
          `目标产物：${input.path}（artifact ${input.artifactId}，v${input.version}）`,
          `选区：${JSON.stringify(input.selection)}`,
          `用户修改要求：${input.instruction}`,
          "先 read_office_file 读回目标产物，确认选区原文仍存在；",
          "再用 edit_office_file 按选区精确修改（DOCX/PPTX 传 find/replace，XLSX 传 sheet/cell/value），",
          "保留文件其余内容和版式；不要用 write_office_file 重写整份文件。",
          "完成后 read_office_file 复核，并提交一份 3–5 步计划等待批准；计划批准前不要写文件。",
        ].join("\n"),
      });
      if (!promptReply.ok) throw new Error(promptReply.error ?? "prompt failed");
    } catch (err) {
      this.failRun(task.id, runId, err instanceof Error ? err.message : String(err));
    }
  }

  private async launchPlan(task: CoworkTask, runId: string): Promise<void> {
    try {
      await this.ensureSession(task, "start", true);
      const planReply = await this.rpcSession(task.session_id!, "set_plan_mode", { enabled: true });
      if (!planReply.ok) throw new Error(planReply.error ?? "set_plan_mode failed");
      const promptReply = await this.rpcSession(task.session_id!, "prompt", {
        message: "请先为这个任务提交 3–8 步计划。计划批准前不要写任何产物。",
      });
      if (!promptReply.ok) throw new Error(promptReply.error ?? "prompt failed");
    } catch (err) {
      this.failRun(task.id, runId, err instanceof Error ? err.message : String(err));
    }
  }

  async pauseTask(taskId: string): Promise<CoworkTask> {
    const task = this.store.getTask(taskId);
    if (!["planning", "awaiting_plan", "running", "awaiting_approval"].includes(task.status)) {
      throw new CoworkConflictError(`当前状态 ${task.status} 不能暂停`);
    }
    const before = task.status;
    if (task.session_id) {
      await this.rpcSession(task.session_id, "cancel", {});
      rejectPendingPiPlansForSession(this.pendingPlans, task.session_id);
      for (const approval of this.store.getPendingApprovals(taskId)) {
        try {
          this.store.resolveApproval(approval.id, "rejected", "task paused");
        } catch {
          // 计划可能已被 cancel 结算；不阻断暂停
        }
      }
      this.active.delete(task.session_id);
    }
    const latest = this.store.getLatestRun(taskId);
    if (latest && latest.status === "running") {
      this.store.updateRunStatus(latest.id, "paused", {
        checkpoint: {
          phase: before,
          paused_at: new Date().toISOString(),
          steps: this.store.getSteps(latest.id).map((s) => ({ seq: s.seq, label: s.label, status: s.status })),
        },
      });
    }
    const paused = this.store.transitionTask(taskId, "paused");
    this.store.appendEvent(taskId, latest?.id ?? null, "cowork.run.paused", {
      phase: before,
      message: "任务已暂停；可从任务详情恢复，已完成步骤不会重复",
    });
    return paused;
  }

  async resumeTask(taskId: string): Promise<{ task: CoworkTask; run_id: string }> {
    const task = this.store.getTask(taskId);
    if (task.status !== "paused") throw new CoworkConflictError(`当前状态 ${task.status} 不能恢复`);
    const latest = this.store.getLatestRun(taskId);
    if (!latest) throw new CoworkConflictError("没有可恢复的运行");
    const previous = (() => {
      try {
        return asRecord(JSON.parse(latest.checkpoint_json || "{}") as unknown);
      } catch {
        return {};
      }
    })();
    const beforePhase = str(previous.phase, "");
    // 上次停在计划审批：恢复必须重新进入 planning，让 onPlanProposed 能推进到
    // awaiting_plan 并显示审批卡；若直接进 running，计划提交后任务会卡在 running。
    const resumeIntoPlanning =
      beforePhase === "planning" || beforePhase === "awaiting_plan" || beforePhase === "awaiting_approval";
    if (latest.status === "paused") {
      // checkpoint 是覆盖写：恢复时必须先把原 phase/steps 带上，否则 resume 会把
      // “上次停在计划审批”洗成空对象，planAgain 误判为 false 直接放写工具。
      this.store.updateRunStatus(latest.id, "running", {
        checkpoint: { ...previous, resumed_at: new Date().toISOString() },
      });
    } else if (latest.status !== "running") {
      throw new CoworkConflictError(`运行状态 ${latest.status} 不能恢复`);
    }
    const next = this.store.transitionTask(taskId, resumeIntoPlanning ? "planning" : "running");
    this.rememberSession(next, latest.id);
    void this.launchResume(next, latest.id);
    return { task: next, run_id: latest.id };
  }

  private async launchResume(task: CoworkTask, runId: string): Promise<void> {
    try {
      const run = this.store.getLatestRun(task.id);
      const checkpoint = run?.checkpoint_json ?? "{}";
      const parsedCheckpoint = (() => {
        try {
          return JSON.parse(checkpoint) as Record<string, unknown>;
        } catch {
          return {};
        }
      })();
      const beforePhase = str(parsedCheckpoint.phase, "");
      const steps = this.store.getSteps(runId).map((step) => `${step.seq}. ${step.label} [${step.status}]`);
      const planAgain = beforePhase === "planning" || beforePhase === "awaiting_plan" || beforePhase === "awaiting_approval";
      await this.ensureSession(task, "resume", planAgain);
      const planReply = await this.rpcSession(task.session_id!, "set_plan_mode", { enabled: planAgain });
      if (!planReply.ok) throw new Error(planReply.error ?? "set_plan_mode failed");
      const prompt = buildCoworkResumePrompt(task, steps, checkpoint);
      const promptReply = await this.rpcSession(task.session_id!, "prompt", {
        message: planAgain ? `上次停在计划审批，请重新提交计划并等待批准。\n\n${prompt}` : prompt,
      });
      if (!promptReply.ok) throw new Error(promptReply.error ?? "prompt failed");
      this.store.appendEvent(task.id, runId, "cowork.run.resumed", {
        phase: beforePhase || "running",
        message: "已恢复执行，已完成步骤不会重复",
      });
    } catch (err) {
      this.failRun(task.id, runId, err instanceof Error ? err.message : String(err));
    }
  }

  async cancelTask(taskId: string): Promise<CoworkTask> {
    const task = this.store.getTask(taskId);
    if (task.status === "completed" || task.status === "cancelled") {
      throw new CoworkConflictError(`当前状态 ${task.status} 不能取消`);
    }
    if (task.session_id) {
      await this.rpcSession(task.session_id, "cancel", {});
      rejectPendingPiPlansForSession(this.pendingPlans, task.session_id);
      for (const approval of this.store.getPendingApprovals(taskId)) {
        try {
          this.store.resolveApproval(approval.id, "rejected", "task cancelled");
        } catch {
          // 已结算的审批忽略
        }
      }
      this.active.delete(task.session_id);
    }
    const latest = this.store.getLatestRun(taskId);
    if (latest && latest.status === "running") {
      this.store.updateRunStatus(latest.id, "cancelled", { error: "cancelled by user" });
    }
    const cancelled = this.store.transitionTask(taskId, "cancelled");
    this.store.appendEvent(taskId, latest?.id ?? null, "cowork.run.cancelled", {
      message: "任务已取消",
    });
    return cancelled;
  }

  async acceptTask(taskId: string): Promise<CoworkTask> {
    const task = this.store.getTask(taskId);
    if (task.status !== "review") throw new CoworkConflictError(`当前状态 ${task.status} 不能验收`);
    const accepted = this.store.transitionTask(taskId, "completed");
    this.store.appendEvent(taskId, this.store.getLatestRun(taskId)?.id ?? null, "cowork.task.completed", {
      message: "用户已验收任务",
      artifacts: this.store.getTaskDetail(taskId).artifacts.length,
    });
    if (task.session_id) {
      void this.rpcSession(task.session_id, "destroy_session", {}).catch(() => {});
      this.active.delete(task.session_id);
    }
    return accepted;
  }

  async decidePlan(approvalId: string, action: "approve" | "reject" | "modify", reason = "", modifiedPlan = ""): Promise<void> {
    const approval = this.store.getApproval(approvalId);
    if (approval.kind !== "plan") throw new CoworkConflictError("审批不是计划审批");
    if (approval.status !== "pending") throw new CoworkConflictError(`审批已处理：${approval.status}`);
    const task = this.store.getTask(approval.task_id);
    // 审批必须属于“当前停在计划审批”的这一轮；陈旧审批（重启/恢复后）一律拒绝，
    // 否则可能批准到上一轮计划或绕过任务状态机。
    if (task.status !== "awaiting_plan") throw new CoworkConflictError(`当前状态 ${task.status} 不需要计划审批`);
    const latest = this.store.getLatestRun(task.id);
    if (!latest || (approval.run_id && approval.run_id !== latest.id)) {
      throw new CoworkConflictError("计划审批不属于当前运行");
    }
    const payload = (() => {
      try {
        return JSON.parse(approval.payload_json) as Record<string, unknown>;
      } catch {
        return {};
      }
    })();
    const planId = str(payload.plan_id);
    if (!planId) throw new CoworkConflictError("计划审批缺少 plan_id");
    if (!task.session_id) throw new CoworkConflictError("任务没有 session_id");
    const reply = await this.rpcSession(task.session_id, "plan_action", {
      plan_id: planId,
      action,
      ...(reason ? { reason } : {}),
      ...(modifiedPlan ? { modified_plan: modifiedPlan } : {}),
    });
    if (!reply.ok) throw new CoworkConflictError(reply.error ?? "plan_action failed");
    const matched = asRecord(reply.result).matched === true;
    if (!matched) throw new CoworkConflictError("计划已超时或不在途，无法批准");
    if (action !== "reject") {
      // 批准/修改后才放开写工具；计划期只暴露只读工具。
      this.applyToolPhase(task.session_id, false);
    }
    const status = action === "approve" ? "approved" : action === "modify" ? "modified" : "rejected";
    this.store.resolveApproval(approvalId, status, reason || null);
    if (action === "reject") {
      if (task.status === "awaiting_plan") this.store.transitionTask(task.id, "planning");
      this.store.appendEvent(task.id, approval.run_id, "cowork.plan.rejected", { reason });
    } else {
      if (task.status === "awaiting_plan") this.store.transitionTask(task.id, "running");
      this.store.appendEvent(task.id, approval.run_id, "cowork.plan.approved", {
        modified: action === "modify",
      });
    }
  }

  async decideTool(approvalId: string, approved: boolean, reason = ""): Promise<void> {
    const approval = this.store.getApproval(approvalId);
    if (approval.kind !== "tool") throw new CoworkConflictError("审批不是工具审批");
    if (approval.status !== "pending") throw new CoworkConflictError(`审批已处理：${approval.status}`);
    const task = this.store.getTask(approval.task_id);
    if (task.status !== "awaiting_approval") throw new CoworkConflictError(`当前状态 ${task.status} 不需要工具审批`);
    const latest = this.store.getLatestRun(task.id);
    if (!latest || (approval.run_id && approval.run_id !== latest.id)) {
      throw new CoworkConflictError("工具审批不属于当前运行");
    }
    const payload = (() => {
      try {
        return JSON.parse(approval.payload_json) as Record<string, unknown>;
      } catch {
        return {};
      }
    })();
    const interactionId = str(payload.interaction_id);
    if (!interactionId) throw new CoworkConflictError("工具审批缺少 interaction_id");
    if (!task.session_id) throw new CoworkConflictError("任务没有 session_id");
    const reply = await this.rpcSession(task.session_id, "user_response", {
      interaction_id: interactionId,
      response: approved ? "yes" : "no",
    });
    if (!reply.ok) throw new CoworkConflictError(reply.error ?? "user_response failed");
    this.store.resolveApproval(approvalId, approved ? "approved" : "rejected", reason || null);
    if (task.status === "awaiting_approval") this.store.transitionTask(task.id, "running");
    this.store.appendEvent(task.id, approval.run_id, "cowork.tool.decided", {
      approved,
      reason,
    });
  }

  /** 运行终止时结算所有在途审批，避免 UI 显示幽灵审批、API 接受幽灵批准。 */
  private expirePendingApprovals(taskId: string, reason: string): void {
    for (const approval of this.store.getPendingApprovals(taskId)) {
      try {
        this.store.resolveApproval(approval.id, "expired", reason);
      } catch {
        // 已被并发处理时忽略
      }
    }
  }

  private failRun(taskId: string, runId: string, message: string): void {
    try {
      const task = this.store.getTask(taskId);
      if (task.status !== "cancelled" && task.status !== "completed") {
        try {
          this.store.transitionTask(taskId, "failed");
        } catch {
          // 当前状态已不可转 failed（例如 paused）；保留运行错误即可
        }
      }
      const run = this.store.getLatestRun(taskId);
      if (run && run.id === runId && run.status === "running") {
        this.store.updateRunStatus(runId, "failed", { error: message });
      }
      this.expirePendingApprovals(taskId, "run failed");
      this.store.appendEvent(taskId, runId, "cowork.run.failed", { error: message });
      if (task.session_id) {
        // 失败后必须中止旧会话：pi 可能在 error 事件后继续重试，甚至晚到地提交
        // submit_plan；不取消会让下一轮新 run 的 active 映射被旧事件污染。
        void this.rpcSession(task.session_id, "cancel", {}).catch(() => {});
        this.active.delete(task.session_id);
      }
    } catch {
      // 失败处理本身不能再抛，避免 API 卡死
    }
  }

  private onApprovalExpired(approval: { id: string; task_id: string; run_id: string | null; kind: string }): void {
    try {
      const task = this.store.getTask(approval.task_id);
      if (approval.kind === "plan" && task.status === "awaiting_plan") {
        this.store.transitionTask(task.id, "planning");
      } else if (approval.kind === "tool" && task.status === "awaiting_approval") {
        this.store.transitionTask(task.id, "running");
      }
    } catch {
      // 状态已经变化，无需二次处理
    }
  }

  // ── kernel 事件 → 任务表/步骤/产物 ──
  private handleEvent(sessionId: string, event: { type: string; payload: Record<string, unknown> }): void {
    const active = this.active.get(sessionId);
    if (!active) return;
    const { taskId, runId } = active;
    const payload = asRecord(event.payload);

    if (event.type === "plan_proposed") {
      this.onPlanProposed(taskId, runId, payload);
      return;
    }
    if (event.type === "plan_completed") {
      this.store.appendEvent(taskId, runId, "cowork.plan.completed", {
        summary: payload.summary ?? {},
      });
      return;
    }
    if (event.type === "ask_user") {
      this.onAskUser(taskId, runId, payload);
      return;
    }
    if (event.type === "cowork.steps.updated") {
      this.onStepsUpdated(taskId, runId, payload);
      return;
    }
    if (event.type === "tool_start") {
      const toolCallId = str(payload.tool_call_id);
      if (toolCallId) this.toolInputs.set(toolCallId, str(payload.input));
      this.store.appendEvent(taskId, runId, "cowork.tool.started", {
        tool_name: str(payload.tool_name),
        tool_call_id: toolCallId,
      });
      return;
    }
    if (event.type === "tool_end") {
      const toolCallId = str(payload.tool_call_id);
      const input = this.toolInputs.get(toolCallId) ?? "";
      this.toolInputs.delete(toolCallId);
      this.onToolEnd(taskId, runId, payload, input);
      return;
    }
    if (event.type === "tool_error") {
      this.store.appendEvent(taskId, runId, "cowork.tool.failed", {
        tool_name: str(payload.tool_name),
        tool_call_id: str(payload.tool_call_id),
        error: truncate(str(payload.error), 1000),
      });
      return;
    }
    if (event.type === "answer") {
      const content = str(payload.content);
      if (content.trim()) {
        this.store.appendEvent(taskId, runId, "cowork.answer", {
          content: truncate(content, 4000),
        });
      }
      return;
    }
    if (event.type === "error") {
      this.store.appendEvent(taskId, runId, "cowork.agent.error", {
        code: str(payload.code, "AGENT_ERROR"),
        message: truncate(str(payload.message), 2000),
      });
      this.failRun(taskId, runId, str(payload.message, "Agent error"));
      return;
    }
    if (event.type === "done") {
      this.onDone(taskId, runId);
    }
  }

  private onPlanProposed(taskId: string, runId: string, payload: Record<string, unknown>): void {
    const planId = str(payload.plan_id);
    if (!planId) return;
    const existing = this.store.getPendingApprovals(taskId).find((approval) => {
      if (approval.kind !== "plan") return false;
      try {
        return str((JSON.parse(approval.payload_json) as Record<string, unknown>).plan_id) === planId;
      } catch {
        return false;
      }
    });
    const steps = Array.isArray(payload.steps) ? payload.steps.map((step) => String(step)) : [];
    const planText = str(payload.plan_text);
    // 计划的步骤先落为 pending，后面的 cowork_update_steps 只更新真实状态。
    for (let i = 0; i < steps.length; i += 1) {
      this.store.upsertStep({
        runId,
        seq: i + 1,
        label: truncate(steps[i]!.trim() || `步骤 ${i + 1}`, 200),
        status: "pending",
        detail: { source: "plan", index: i + 1 },
      });
    }
    const task = this.store.getTask(taskId);
    if (task.status === "planning" || task.status === "running") {
      this.store.transitionTask(taskId, "awaiting_plan");
    }
    if (!existing) {
      this.store.createApproval({
        taskId,
        runId,
        kind: "plan",
        payload: { plan_id: planId, plan_text: planText, steps },
        ttlMs: PLAN_APPROVAL_TTL_MS,
      });
    } else {
      this.store.appendEvent(taskId, runId, "cowork.plan.proposed", {
        approval_id: existing.id,
        plan_id: planId,
        steps,
        message: "计划仍在等待批准",
      });
    }
  }

  private onAskUser(taskId: string, runId: string, payload: Record<string, unknown>): void {
    const interactionId = str(payload.interaction_id);
    if (!interactionId) return;
    const task = this.store.getTask(taskId);
    if (task.status === "running") this.store.transitionTask(taskId, "awaiting_approval");
    const existing = this.store.getPendingApprovals(taskId).find((approval) => {
      if (approval.kind !== "tool") return false;
      try {
        return str((JSON.parse(approval.payload_json) as Record<string, unknown>).interaction_id) === interactionId;
      } catch {
        return false;
      }
    });
    if (existing) return;
    this.store.createApproval({
      taskId,
      runId,
      kind: "tool",
      payload: {
        interaction_id: interactionId,
        tool_name: str(payload.tool_name),
        tool_call_id: str(payload.tool_call_id),
        question: str(payload.question),
        risk_level: str(payload.risk_level, "medium"),
        options: payload.options ?? [],
        tool_input: truncate(str(payload.tool_input, "{}"), 1500),
      },
      ttlMs: TOOL_APPROVAL_TTL_MS,
    });
  }

  private onStepsUpdated(taskId: string, runId: string, payload: Record<string, unknown>): void {
    const steps = Array.isArray(payload.steps) ? payload.steps : [];
    for (const raw of steps) {
      const step = asRecord(raw);
      const seq = Number(step.seq);
      const label = str(step.label).trim();
      const status = str(step.status) as "pending" | "running" | "completed" | "failed" | "skipped";
      if (!Number.isInteger(seq) || seq < 1 || !label || !["pending", "running", "completed", "failed", "skipped"].includes(status)) {
        continue;
      }
      this.store.upsertStep({
        runId,
        seq,
        label: truncate(label, 200),
        status,
        detail: { detail: truncate(str(step.detail), 1000), source: "agent" },
        startedAt: status === "running" ? new Date().toISOString() : undefined,
        endedAt: status === "completed" || status === "failed" || status === "skipped" ? new Date().toISOString() : undefined,
      });
    }
    this.store.appendEvent(taskId, runId, "cowork.steps.updated", {
      count: steps.length,
    });
  }

  private onToolEnd(taskId: string, runId: string, payload: Record<string, unknown>, input = ""): void {
    const toolName = str(payload.tool_name);
    this.store.appendEvent(taskId, runId, "cowork.tool.completed", {
      tool_name: toolName,
      tool_call_id: str(payload.tool_call_id),
      elapsed: payload.elapsed ?? null,
    });
    const task = this.store.getTask(taskId);
    const artifact = artifactFromToolResult(toolName, payload.output, input, task.staging_root);
    if (!artifact) return;
    this.store.addArtifact({
      taskId,
      runId,
      path: artifact.path,
      kind: artifact.kind,
      status: "staged",
      sources: [taskId],
    });
  }

  private onDone(taskId: string, runId: string): void {
    finishCoworkRun({
      store: this.store,
      expirePendingApprovals: (id, reason) => this.expirePendingApprovals(id, reason),
      deactivateSession: (sessionId) => this.active.delete(sessionId),
    }, taskId, runId);
  }
}
