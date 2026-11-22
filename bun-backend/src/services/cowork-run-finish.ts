/** 一轮 Agent 结束后的任务收尾。从 orchestrator 拆出，避免单文件继续变胖。 */

import type { CoworkStore } from "./cowork-store";

export function finishCoworkRun(input: {
  store: CoworkStore;
  expirePendingApprovals: (taskId: string, reason: string) => void;
  deactivateSession: (sessionId: string) => void;
}, taskId: string, runId: string): void {
  const task = input.store.getTask(taskId);
  if (task.status === "paused" || task.status === "cancelled" || task.status === "completed") return;
  // 计划阶段没有提交计划就结束：不能停在 planning 让用户误以为还在跑。
  if (task.status === "planning") {
    const message = "Agent 在计划阶段结束，但没有提交计划";
    input.store.appendEvent(taskId, runId, "cowork.run.failed", { error: message });
    try {
      input.store.transitionTask(taskId, "failed");
      const latest = input.store.getLatestRun(taskId);
      if (latest && latest.id === runId && latest.status === "running") {
        input.store.updateRunStatus(runId, "failed", { error: message });
      }
      input.expirePendingApprovals(taskId, "run ended in planning");
    } catch {
      // 状态已变化时保持原状
    }
    if (task.session_id) input.deactivateSession(task.session_id);
    return;
  }
  for (const step of input.store.getSteps(runId)) {
    if (step.status === "pending" || step.status === "running") {
      input.store.upsertStep({
        runId,
        seq: step.seq,
        label: step.label,
        status: "skipped",
        detail: { reason: "agent finished without explicit step status" },
        endedAt: new Date().toISOString(),
      });
    }
  }
  try {
    if (task.status === "running" || task.status === "awaiting_approval" || task.status === "awaiting_plan") {
      input.store.transitionTask(taskId, "review");
    }
    const latest = input.store.getLatestRun(taskId);
    if (latest && latest.id === runId && latest.status === "running") {
      input.expirePendingApprovals(taskId, "run completed");
      input.store.updateRunStatus(runId, "completed", {
        checkpoint: { completed_at: new Date().toISOString() },
      });
    }
    input.store.appendEvent(taskId, runId, "cowork.run.completed", {
      message: "本轮执行结束，等待验收",
      artifacts: input.store.getTaskDetail(taskId).artifacts.length,
    });
  } catch {
    // 状态已由用户改变（暂停/取消）时不再强推 review
  } finally {
    if (task.session_id) input.deactivateSession(task.session_id);
  }
}
