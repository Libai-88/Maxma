/**
 * 应用重启后的 Cowork 恢复（M1，M3 拆分）。
 *
 * 只依赖 context 暴露的任务状态读写，不直接操作任务表之外的状态机；
 * 保留原实现的 phase 推断与审批结算顺序，避免恢复后绕过计划审批。
 */
import type { Database } from "bun:sqlite";

import type {
  CoworkApproval,
  CoworkEvent,
  CoworkRun,
  CoworkStep,
  CoworkTaskStatus,
} from "./cowork-store";

function nowIso(): string {
  return new Date().toISOString();
}

export interface CoworkRecoveryContext {
  db: Database;
  getLatestRun: (taskId: string) => CoworkRun | null;
  getPendingApprovals: (taskId: string) => CoworkApproval[];
  updateRunStatus: (runId: string, status: "paused", patch: {
    checkpoint: Record<string, unknown>;
  }) => CoworkRun;
  getSteps: (runId: string) => CoworkStep[];
  resolveApproval: (approvalId: string, status: "expired", reason: string | null) => CoworkApproval;
  appendEvent: (taskId: string, runId: string | null, type: string, payload: Record<string, unknown>) => CoworkEvent;
}

export function recoverInterruptedTasks(ctx: CoworkRecoveryContext): number {
  const rows = ctx.db
    .query(
      `SELECT id, status FROM cowork_tasks
       WHERE status IN ('planning','awaiting_plan','running','awaiting_approval')`,
    )
    .all() as Array<{ id: string; status: CoworkTaskStatus }>;
  let count = 0;
  for (const row of rows) {
    const latest = ctx.getLatestRun(row.id);
    const pendingBeforeRecovery = ctx.getPendingApprovals(row.id);
    const phase = pendingBeforeRecovery.some((approval) => approval.kind === "plan")
      ? "awaiting_plan"
      : pendingBeforeRecovery.some((approval) => approval.kind === "tool")
        ? "awaiting_approval"
        : row.status;
    const previous = (() => {
      if (!latest) return {};
      try {
        return JSON.parse(latest.checkpoint_json || "{}") as Record<string, unknown>;
      } catch {
        return {};
      }
    })();
    if (latest && latest.status === "running") {
      ctx.updateRunStatus(latest.id, "paused", {
        checkpoint: {
          ...previous,
          phase,
          reason: "app_restart",
          interrupted_at: nowIso(),
          last_step_seq: ctx.getSteps(latest.id).length,
        },
      });
    }
    ctx.db
      .query("UPDATE cowork_tasks SET status = 'paused', updated_at = ? WHERE id = ?")
      .run(nowIso(), row.id);
    for (const approval of pendingBeforeRecovery) {
      try {
        ctx.resolveApproval(approval.id, "expired", "app restart");
      } catch {
        // 审批可能已被上一轮 cancel/pause 结算；恢复流程不因它中断
      }
    }
    ctx.appendEvent(row.id, latest?.id ?? null, "cowork.run.interrupted", {
      reason: "app_restart",
      message: "应用重启前任务未完成；已保留步骤，可恢复继续",
    });
    count += 1;
  }
  return count;
}
