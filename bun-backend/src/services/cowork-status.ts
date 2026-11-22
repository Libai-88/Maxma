/** Cowork 任务/运行/步骤/审批的状态枚举（M3 拆分，供 store 与恢复/调度模块共享）。 */
export const COWORK_TASK_STATUSES = [
  "draft",
  "planning",
  "awaiting_plan",
  "running",
  "awaiting_approval",
  "paused",
  "review",
  "completed",
  "failed",
  "cancelled",
] as const;

export type CoworkTaskStatus = (typeof COWORK_TASK_STATUSES)[number];

export const COWORK_RUN_STATUSES = ["running", "paused", "completed", "failed", "cancelled"] as const;
export type CoworkRunStatus = (typeof COWORK_RUN_STATUSES)[number];

export const COWORK_STEP_STATUSES = ["pending", "running", "completed", "failed", "skipped"] as const;
export type CoworkStepStatus = (typeof COWORK_STEP_STATUSES)[number];

export type CoworkApprovalKind = "plan" | "tool";
export const COWORK_APPROVAL_STATUSES = ["pending", "approved", "rejected", "modified", "expired"] as const;
export type CoworkApprovalStatus = (typeof COWORK_APPROVAL_STATUSES)[number];
