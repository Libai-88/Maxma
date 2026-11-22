/**
 * Cowork 任务域（M1）。
 *
 * 设计边界：
 * - 任务表是唯一状态源。UI 不维护第二套状态，只消费这里的状态与事件。
 * - 所有状态变更走 `transitionTask` 的显式白名单，非法跳转抛 409，不静默吞掉。
 * - 事件写入 `cowork_task_events` 后立刻发布给 SSE 订阅者；事件 id 是全局游标。
 * - staging 目录只用于任务产物，源工作区永远不直接写；路径策略在 kernel 侧兜底。
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { Database } from "bun:sqlite";

import { getApiDataDir } from "../app-paths";
import { getConnection } from "../db/core";
import {
  MAXMA_PERMISSION_MODES,
  type MaxmaPermissionMode,
} from "../../../bun-sidecar/src/kernel/pi-contract";

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

export interface CoworkTask {
  id: string;
  project_id: string | null;
  title: string;
  objective: string;
  status: CoworkTaskStatus;
  workspace_root: string;
  staging_root: string;
  permission_mode: string;
  model_policy_json: string;
  data_policy: string;
  inputs_json: string;
  session_id: string | null;
  schedule_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CoworkRun {
  id: string;
  task_id: string;
  attempt: number;
  status: CoworkRunStatus;
  started_at: string;
  ended_at: string | null;
  error: string | null;
  checkpoint_json: string;
  usage_json: string;
}

export interface CoworkStep {
  id: string;
  run_id: string;
  seq: number;
  label: string;
  status: CoworkStepStatus;
  detail_json: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface CoworkArtifact {
  id: string;
  task_id: string;
  run_id: string | null;
  kind: string;
  path: string;
  version: number;
  sha256: string;
  size_bytes: number;
  template_id: string | null;
  status: string;
  sources_json: string;
  created_at: string;
}

export interface CoworkApproval {
  id: string;
  task_id: string;
  run_id: string | null;
  kind: CoworkApprovalKind;
  payload_json: string;
  status: CoworkApprovalStatus;
  decision_reason: string | null;
  expires_at: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface CoworkEvent {
  id: number;
  task_id: string;
  run_id: string | null;
  type: string;
  payload_json: string;
  created_at: string;
}

export interface CoworkTaskDetail {
  task: CoworkTask;
  runs: CoworkRun[];
  steps: CoworkStep[];
  artifacts: CoworkArtifact[];
  approvals: CoworkApproval[];
  events: CoworkEvent[];
  latest_run: CoworkRun | null;
}

export class CoworkConflictError extends Error {
  readonly code = "COWORK_CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "CoworkConflictError";
  }
}

export class CoworkNotFoundError extends Error {
  readonly code = "COWORK_NOT_FOUND";
  constructor(message: string) {
    super(message);
    this.name = "CoworkNotFoundError";
  }
}

export class CoworkValidationError extends Error {
  readonly code = "COWORK_VALIDATION";
  constructor(message: string) {
    super(message);
    this.name = "CoworkValidationError";
  }
}

const TASK_TRANSITIONS: Record<CoworkTaskStatus, CoworkTaskStatus[]> = {
  draft: ["planning", "cancelled"],
  planning: ["awaiting_plan", "running", "paused", "failed", "cancelled"],
  awaiting_plan: ["running", "planning", "paused", "failed", "cancelled"],
  running: ["awaiting_plan", "awaiting_approval", "paused", "review", "failed", "cancelled"],
  awaiting_approval: ["running", "paused", "failed", "cancelled"],
  paused: ["running", "planning", "cancelled"],
  review: ["completed", "planning", "cancelled"],
  completed: ["planning"],
  failed: ["planning", "cancelled"],
  cancelled: ["planning"],
};

const RUN_TRANSITIONS: Record<CoworkRunStatus, CoworkRunStatus[]> = {
  running: ["paused", "completed", "failed", "cancelled"],
  paused: ["running", "failed", "cancelled"],
  completed: [],
  failed: ["running"],
  cancelled: [],
};

export function coworkTaskRoot(): string {
  return path.join(getApiDataDir(), "cowork", "tasks");
}

export function coworkTaskStagingRoot(taskId: string): string {
  return path.join(coworkTaskRoot(), taskId, "staging");
}

/**
 * 每个交付物版本独立保存一份字节快照，避免同路径覆盖后历史版本只剩 sha256。
 * 目录放在任务根下、staging 之外；下载路由按 artifact id 取快照，不依赖 DB 新列。
 */
export function coworkArtifactSnapshotPath(taskId: string, artifactId: string, sourcePath: string): string {
  return path.join(coworkTaskRoot(), taskId, "artifact-versions", artifactId, path.basename(sourcePath));
}

function nowIso(): string {
  return new Date().toISOString();
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function isPermissionMode(value: string | undefined): value is MaxmaPermissionMode {
  return typeof value === "string" && (MAXMA_PERMISSION_MODES as readonly string[]).includes(value);
}

function normalizeWorkspaceRoot(raw: string): string {
  if (!path.isAbsolute(raw)) {
    throw new CoworkValidationError("workspace_root 必须是绝对路径");
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(raw);
  } catch {
    throw new CoworkValidationError("workspace_root 不存在或不可访问");
  }
  if (!stat.isDirectory()) throw new CoworkValidationError("workspace_root 必须是文件夹");
  return fs.realpathSync(raw);
}

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export interface CoworkStoreOptions {
  db?: Database;
  /** 测试可传入临时 DB；生产沿用单例连接。 */
  ownsDb?: boolean;
}

export class CoworkStore {
  private readonly db: Database;
  private readonly ownsDb: boolean;
  private readonly listeners = new Map<string, Set<(event: CoworkEvent) => void>>();

  constructor(opts: CoworkStoreOptions = {}) {
    this.db = opts.db ?? getConnection();
    this.ownsDb = opts.ownsDb ?? !opts.db;
  }

  close(): void {
    if (this.ownsDb) this.db.close();
  }

  // ── 事件总线 ──
  subscribe(taskId: string, listener: (event: CoworkEvent) => void): () => void {
    let set = this.listeners.get(taskId);
    if (!set) {
      set = new Set();
      this.listeners.set(taskId, set);
    }
    set.add(listener);
    return () => {
      const current = this.listeners.get(taskId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(taskId);
    };
  }

  private publish(event: CoworkEvent): void {
    const set = this.listeners.get(event.task_id);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // SSE 连接断开时 listener 自己清理；不能因为一个消费者影响任务状态写入。
      }
    }
  }

  appendEvent(taskId: string, runId: string | null, type: string, payload: Record<string, unknown>): CoworkEvent {
    const createdAt = nowIso();
    const result = this.db
      .query(
        `INSERT INTO cowork_task_events (task_id, run_id, type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(taskId, runId, type, JSON.stringify(payload), createdAt);
    const event: CoworkEvent = {
      id: Number(result.lastInsertRowid),
      task_id: taskId,
      run_id: runId,
      type,
      payload_json: JSON.stringify(payload),
      created_at: createdAt,
    };
    this.publish(event);
    return event;
  }

  listEvents(taskId: string, after = 0, limit = 200): CoworkEvent[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    return this.db
      .query(
        `SELECT id, task_id, run_id, type, payload_json, created_at
         FROM cowork_task_events
         WHERE task_id = ? AND id > ?
         ORDER BY id ASC
         LIMIT ?`,
      )
      .all(taskId, Math.max(0, Math.floor(after)), safeLimit) as CoworkEvent[];
  }

  // ── 任务 ──
  createTask(input: {
    title: string;
    objective: string;
    workspace_root: string;
    permission_mode?: string;
    project_id?: string | null;
    data_policy?: string;
    inputs?: Record<string, unknown>;
  }): CoworkTask {
    const title = input.title.trim();
    const objective = input.objective.trim();
    if (!title) throw new CoworkValidationError("任务标题不能为空");
    if (!objective) throw new CoworkValidationError("任务目标不能为空");
    const workspaceRoot = normalizeWorkspaceRoot(input.workspace_root);
    const permissionMode = isPermissionMode(input.permission_mode)
      ? input.permission_mode
      : "operate";
    const id = crypto.randomUUID();
    const stagingRoot = coworkTaskStagingRoot(id);
    fs.mkdirSync(stagingRoot, { recursive: true });
    const createdAt = nowIso();
    this.db
      .query(
        `INSERT INTO cowork_tasks
          (id, project_id, title, objective, status, workspace_root, staging_root,
           permission_mode, model_policy_json, data_policy, inputs_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, '{}', ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.project_id ?? null,
        title,
        objective,
        workspaceRoot,
        stagingRoot,
        permissionMode,
        input.data_policy === "local_only" ? "local_only" : "local_only",
        JSON.stringify(input.inputs ?? {}),
        createdAt,
        createdAt,
      );
    this.appendEvent(id, null, "cowork.task.created", {
      title,
      objective,
      workspace_root: workspaceRoot,
    });
    return this.getTask(id);
  }

  getTask(taskId: string): CoworkTask {
    const row = this.db.query("SELECT * FROM cowork_tasks WHERE id = ?").get(taskId) as CoworkTask | null;
    if (!row) throw new CoworkNotFoundError(`任务不存在：${taskId}`);
    return row;
  }

  listTasks(): CoworkTask[] {
    return this.db
      .query("SELECT * FROM cowork_tasks ORDER BY updated_at DESC")
      .all() as CoworkTask[];
  }

  getTaskDetail(taskId: string): CoworkTaskDetail {
    const task = this.getTask(taskId);
    const runs = this.db
      .query("SELECT * FROM cowork_runs WHERE task_id = ? ORDER BY attempt DESC")
      .all(taskId) as CoworkRun[];
    const latestRun = runs[0] ?? null;
    const steps = latestRun
      ? (this.db
          .query("SELECT * FROM cowork_steps WHERE run_id = ? ORDER BY seq ASC")
          .all(latestRun.id) as CoworkStep[])
      : [];
    const artifacts = this.db
      .query("SELECT * FROM cowork_artifacts WHERE task_id = ? ORDER BY created_at DESC")
      .all(taskId) as CoworkArtifact[];
    const approvals = this.db
      .query("SELECT * FROM cowork_approvals WHERE task_id = ? ORDER BY created_at DESC")
      .all(taskId) as CoworkApproval[];
    const events = this.listEvents(taskId, 0, 200);
    return { task, runs, steps, artifacts, approvals, events, latest_run: latestRun };
  }

  transitionTask(
    taskId: string,
    next: CoworkTaskStatus,
    patch: Partial<Pick<CoworkTask, "completed_at">> = {},
  ): CoworkTask {
    const task = this.getTask(taskId);
    if (task.status !== next && !TASK_TRANSITIONS[task.status].includes(next)) {
      throw new CoworkConflictError(`任务状态不能从 ${task.status} 变为 ${next}`);
    }
    const updatedAt = nowIso();
    const completedAt = next === "completed" ? (patch.completed_at ?? updatedAt) : task.completed_at;
    this.db
      .query("UPDATE cowork_tasks SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?")
      .run(next, updatedAt, completedAt, taskId);
    return this.getTask(taskId);
  }

  setTaskSession(taskId: string, sessionId: string): void {
    this.db
      .query("UPDATE cowork_tasks SET session_id = ?, updated_at = ? WHERE id = ?")
      .run(sessionId, nowIso(), taskId);
  }

  // ── 运行 ──
  createRun(taskId: string, options: { freshSession?: boolean } = {}): CoworkRun {
    const task = this.getTask(taskId);
    const previous = this.db
      .query("SELECT MAX(attempt) AS attempt FROM cowork_runs WHERE task_id = ?")
      .get(taskId) as { attempt: number | null };
    const attempt = Number(previous?.attempt ?? 0) + 1;
    const run: CoworkRun = {
      id: crypto.randomUUID(),
      task_id: taskId,
      attempt,
      status: "running",
      started_at: nowIso(),
      ended_at: null,
      error: null,
      checkpoint_json: "{}",
      usage_json: "{}",
    };
    this.db
      .query(
        `INSERT INTO cowork_runs
          (id, task_id, attempt, status, started_at, ended_at, error, checkpoint_json, usage_json)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, '{}', '{}')`,
      )
      .run(run.id, taskId, attempt, run.status, run.started_at);
    // 失败/取消后的重跑必须换新会话：旧会话可能还停在上一轮 prompt 或待审批的
    // submit_plan 上，复用会把旧事件带进新 run（真实 E2E 已复现）。
    if (!task.session_id || options.freshSession) {
      const sessionId = crypto.randomUUID().replace(/-/g, "");
      this.setTaskSession(taskId, sessionId);
    }
    this.appendEvent(taskId, run.id, "cowork.run.started", { attempt });
    return run;
  }

  getLatestRun(taskId: string): CoworkRun | null {
    return (this.db
      .query("SELECT * FROM cowork_runs WHERE task_id = ? ORDER BY attempt DESC")
      .get(taskId) as CoworkRun | null) ?? null;
  }

  updateRunStatus(runId: string, status: CoworkRunStatus, patch: {
    error?: string | null;
    checkpoint?: Record<string, unknown>;
    usage?: Record<string, unknown>;
  } = {}): CoworkRun {
    const run = this.db.query("SELECT * FROM cowork_runs WHERE id = ?").get(runId) as CoworkRun | null;
    if (!run) throw new CoworkNotFoundError(`运行不存在：${runId}`);
    if (run.status !== status && !RUN_TRANSITIONS[run.status].includes(status)) {
      throw new CoworkConflictError(`运行状态不能从 ${run.status} 变为 ${status}`);
    }
    const endedAt = status === "completed" || status === "failed" || status === "cancelled"
      ? (run.ended_at ?? nowIso())
      : null;
    this.db
      .query(
        `UPDATE cowork_runs
         SET status = ?, ended_at = ?, error = ?, checkpoint_json = ?, usage_json = ?
         WHERE id = ?`,
      )
      .run(
        status,
        endedAt,
        patch.error ?? run.error,
        JSON.stringify(patch.checkpoint ?? JSON.parse(run.checkpoint_json || "{}")),
        JSON.stringify(patch.usage ?? JSON.parse(run.usage_json || "{}")),
        runId,
      );
    return this.db.query("SELECT * FROM cowork_runs WHERE id = ?").get(runId) as CoworkRun;
  }

  // ── 步骤 ──
  upsertStep(input: {
    runId: string;
    seq: number;
    label: string;
    status?: CoworkStepStatus;
    detail?: Record<string, unknown>;
    startedAt?: string | null;
    endedAt?: string | null;
  }): CoworkStep {
    const seq = Math.max(1, Math.floor(input.seq));
    const existing = this.db
      .query("SELECT * FROM cowork_steps WHERE run_id = ? AND seq = ?")
      .get(input.runId, seq) as CoworkStep | null;
    if (existing) {
      this.db
        .query(
          `UPDATE cowork_steps
           SET label = ?, status = ?, detail_json = ?, started_at = ?, ended_at = ?
           WHERE id = ?`,
        )
        .run(
          input.label,
          input.status ?? existing.status,
          JSON.stringify(input.detail ?? JSON.parse(existing.detail_json || "{}")),
          input.startedAt ?? existing.started_at,
          input.endedAt ?? existing.ended_at,
          existing.id,
        );
      return this.db.query("SELECT * FROM cowork_steps WHERE id = ?").get(existing.id) as CoworkStep;
    }
    const step: CoworkStep = {
      id: crypto.randomUUID(),
      run_id: input.runId,
      seq,
      label: input.label,
      status: input.status ?? "pending",
      detail_json: JSON.stringify(input.detail ?? {}),
      started_at: input.startedAt ?? null,
      ended_at: input.endedAt ?? null,
    };
    this.db
      .query(
        `INSERT INTO cowork_steps
          (id, run_id, seq, label, status, detail_json, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(step.id, step.run_id, step.seq, step.label, step.status, step.detail_json, step.started_at, step.ended_at);
    return step;
  }

  getSteps(runId: string): CoworkStep[] {
    return this.db
      .query("SELECT * FROM cowork_steps WHERE run_id = ? ORDER BY seq ASC")
      .all(runId) as CoworkStep[];
  }

  // ── 交付物 ──
  addArtifact(input: {
    taskId: string;
    runId: string | null;
    path: string;
    kind: string;
    templateId?: string | null;
    sources?: string[];
    status?: string;
  }): CoworkArtifact {
    const absPath = path.resolve(input.path);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absPath);
    } catch {
      throw new CoworkValidationError(`交付物不存在：${absPath}`);
    }
    if (!stat.isFile()) throw new CoworkValidationError("交付物必须是文件");
    const task = this.getTask(input.taskId);
    const stagingRoot = task.staging_root;
    if (absPath !== stagingRoot && !absPath.startsWith(stagingRoot + path.sep)) {
      throw new CoworkValidationError("交付物只能登记在任务 staging 目录内");
    }
    const existing = this.db
      .query("SELECT MAX(version) AS version FROM cowork_artifacts WHERE task_id = ? AND path = ?")
      .get(input.taskId, absPath) as { version: number | null };
    const version = Number(existing?.version ?? 0) + 1;
    const artifact: CoworkArtifact = {
      id: crypto.randomUUID(),
      task_id: input.taskId,
      run_id: input.runId,
      kind: input.kind,
      path: absPath,
      version,
      sha256: sha256File(absPath),
      size_bytes: stat.size,
      template_id: input.templateId ?? null,
      status: input.status ?? "staged",
      sources_json: JSON.stringify(input.sources ?? []),
      created_at: nowIso(),
    };
    const snapshot = coworkArtifactSnapshotPath(input.taskId, artifact.id, absPath);
    fs.mkdirSync(path.dirname(snapshot), { recursive: true });
    fs.copyFileSync(absPath, snapshot);
    this.db
      .query(
        `INSERT INTO cowork_artifacts
          (id, task_id, run_id, kind, path, version, sha256, size_bytes, template_id, status, sources_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifact.id,
        artifact.task_id,
        artifact.run_id,
        artifact.kind,
        artifact.path,
        artifact.version,
        artifact.sha256,
        artifact.size_bytes,
        artifact.template_id,
        artifact.status,
        artifact.sources_json,
        artifact.created_at,
      );
    this.appendEvent(input.taskId, input.runId, "cowork.artifact.created", {
      artifact_id: artifact.id,
      kind: artifact.kind,
      path: artifact.path,
      version: artifact.version,
      sha256: artifact.sha256,
      size_bytes: artifact.size_bytes,
    });
    return artifact;
  }

  // ── 审批 ──
  createApproval(input: {
    taskId: string;
    runId: string | null;
    kind: CoworkApprovalKind;
    payload: Record<string, unknown>;
    ttlMs?: number;
  }): CoworkApproval {
    const createdAt = nowIso();
    const expiresAt = input.ttlMs === undefined ? null : new Date(Date.now() + input.ttlMs).toISOString();
    const approval: CoworkApproval = {
      id: crypto.randomUUID(),
      task_id: input.taskId,
      run_id: input.runId,
      kind: input.kind,
      payload_json: JSON.stringify(input.payload),
      status: "pending",
      decision_reason: null,
      expires_at: expiresAt,
      created_at: createdAt,
      resolved_at: null,
    };
    this.db
      .query(
        `INSERT INTO cowork_approvals
          (id, task_id, run_id, kind, payload_json, status, decision_reason, expires_at, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, 'pending', NULL, ?, ?, NULL)`,
      )
      .run(approval.id, approval.task_id, approval.run_id, approval.kind, approval.payload_json, approval.expires_at, approval.created_at);
    this.appendEvent(input.taskId, input.runId, "cowork.approval.requested", {
      approval_id: approval.id,
      kind: approval.kind,
      payload: input.payload,
      expires_at: approval.expires_at,
    });
    return approval;
  }

  getApproval(approvalId: string): CoworkApproval {
    const row = this.db.query("SELECT * FROM cowork_approvals WHERE id = ?").get(approvalId) as CoworkApproval | null;
    if (!row) throw new CoworkNotFoundError(`审批不存在：${approvalId}`);
    return row;
  }

  getPendingApprovals(taskId: string): CoworkApproval[] {
    return this.db
      .query("SELECT * FROM cowork_approvals WHERE task_id = ? AND status = 'pending' ORDER BY created_at ASC")
      .all(taskId) as CoworkApproval[];
  }

  resolveApproval(approvalId: string, status: CoworkApprovalStatus, reason: string | null = null): CoworkApproval {
    const approval = this.getApproval(approvalId);
    if (approval.status !== "pending") {
      throw new CoworkConflictError(`审批已处理：${approval.status}`);
    }
    const resolvedAt = nowIso();
    this.db
      .query("UPDATE cowork_approvals SET status = ?, decision_reason = ?, resolved_at = ? WHERE id = ?")
      .run(status, reason, resolvedAt, approvalId);
    this.appendEvent(approval.task_id, approval.run_id, "cowork.approval.resolved", {
      approval_id: approvalId,
      kind: approval.kind,
      status,
      reason,
    });
    return this.getApproval(approvalId);
  }

  /** 审批超时兜底（kernel 侧也会拒绝，但 UI/任务表必须同步显示 expired）。 */
  expirePendingApprovals(now = Date.now()): CoworkApproval[] {
    const rows = this.db
      .query("SELECT * FROM cowork_approvals WHERE status = 'pending' AND expires_at IS NOT NULL")
      .all() as CoworkApproval[];
    const expired: CoworkApproval[] = [];
    for (const row of rows) {
      const ts = Date.parse(row.expires_at ?? "");
      if (!Number.isFinite(ts) || ts > now) continue;
      this.db
        .query("UPDATE cowork_approvals SET status = 'expired', decision_reason = ?, resolved_at = ? WHERE id = ?")
        .run("approval timeout", nowIso(), row.id);
      this.appendEvent(row.task_id, row.run_id, "cowork.approval.resolved", {
        approval_id: row.id,
        kind: row.kind,
        status: "expired",
        reason: "approval timeout",
      });
      expired.push(this.getApproval(row.id));
    }
    return expired;
  }

  /** 应用重启后，把“进程内已不可能继续”的中间态标成 paused，并写入可恢复 checkpoint。 */
  recoverInterruptedTasks(): number {
    const rows = this.db
      .query(
        `SELECT id, status FROM cowork_tasks
         WHERE status IN ('planning','awaiting_plan','running','awaiting_approval')`,
      )
      .all() as Array<{ id: string; status: CoworkTaskStatus }>;
    let count = 0;
    for (const row of rows) {
      const latest = this.getLatestRun(row.id);
      const pendingBeforeRecovery = this.getPendingApprovals(row.id);
      // 状态与在途审批可能短暂不一致（例如恢复后重新提交计划但状态未及时推进）；
      // 以审批种类为准修正 phase，避免重启恢复后绕过计划审批直接执行。
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
        // phase 必须保留：否则 paused→resume 会把“等待计划审批”误判成直接执行，
        // 相当于应用重启后绕过计划审批。row.status 是中断瞬间最可信的阶段。
        this.updateRunStatus(latest.id, "paused", {
          checkpoint: {
            ...previous,
            phase,
            reason: "app_restart",
            interrupted_at: nowIso(),
            last_step_seq: this.getSteps(latest.id).length,
          },
        });
      }
      this.db
        .query(
          "UPDATE cowork_tasks SET status = 'paused', updated_at = ? WHERE id = ?",
        )
        .run(nowIso(), row.id);
      // 进程重启后在途审批已不可能被原会话消费；先结算掉，避免恢复后 UI 显示
      // “计划等待批准”却实际直接执行，也避免批准一个上一轮的幽灵计划。
      for (const approval of pendingBeforeRecovery) {
        try {
          this.resolveApproval(approval.id, "expired", "app restart");
        } catch {
          // 审批可能已被上一轮 cancel/pause 结算；恢复流程不因它中断
        }
      }
      this.appendEvent(row.id, latest?.id ?? null, "cowork.run.interrupted", {
        reason: "app_restart",
        message: "应用重启前任务未完成；已保留步骤，可恢复继续",
      });
      count += 1;
    }
    return count;
  }
}
