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
import { listActivity as queryActivity } from "./cowork-activity-store";
import { CoworkConflictError, CoworkNotFoundError, CoworkValidationError } from "./cowork-errors";
import {
  addProjectAsset as addProjectAssetRow,
  attachAssetToTask as attachProjectAssetToTask,
  coworkProjectAssetsRoot,
  createProject as createProjectRow,
  getProject as getProjectRow,
  getProjectAsset as getProjectAssetRow,
  isPathInside,
  listProjectAssets as queryProjectAssets,
  listProjectEvents as queryProjectEvents,
  listProjects as queryProjects,
  normalizeWorkspaceRoots,
  removeProjectAsset as removeProjectAssetRow,
  updateProject as updateProjectRow,
  type CoworkProjectContext,
} from "./cowork-project-store";
import { recoverInterruptedTasks as recoverTasks } from "./cowork-recovery";
import {
  RUN_TRANSITIONS,
  TASK_TRANSITIONS,
  asString,
  coworkArtifactSnapshotPath,
  coworkTaskRoot,
  coworkTaskStagingRoot,
  isPermissionMode,
  normalizeWorkspaceRoot,
  nowIso,
  sha256File,
} from "./cowork-store-support";

export { CoworkConflictError, CoworkNotFoundError, CoworkValidationError } from "./cowork-errors";
export {
  coworkProjectAssetsRoot,
  isPathInside,
  normalizeWorkspaceRoots,
} from "./cowork-project-store";

export {
  COWORK_APPROVAL_STATUSES,
  COWORK_RUN_STATUSES,
  COWORK_STEP_STATUSES,
  COWORK_TASK_STATUSES,
  type CoworkApprovalKind,
  type CoworkApprovalStatus,
  type CoworkRunStatus,
  type CoworkStepStatus,
  type CoworkTaskStatus,
} from "./cowork-status";

import type {
  CoworkApprovalKind,
  CoworkApprovalStatus,
  CoworkRunStatus,
  CoworkStepStatus,
  CoworkTaskStatus,
} from "./cowork-status";

export type {
  CoworkTask,
  CoworkRun,
  CoworkStep,
  CoworkArtifact,
  CoworkApproval,
  CoworkEvent,
  CoworkTaskDetail,
  CoworkProject,
  CoworkProjectAsset,
  CoworkSchedule,
} from "./cowork-store-types";

import type {
  CoworkTask,
  CoworkRun,
  CoworkStep,
  CoworkArtifact,
  CoworkApproval,
  CoworkEvent,
  CoworkTaskDetail,
  CoworkProject,
  CoworkProjectAsset,
  CoworkSchedule,
} from "./cowork-store-types";

export { coworkArtifactSnapshotPath, coworkTaskRoot, coworkTaskStagingRoot } from "./cowork-store-support";

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

  /** 跨任务活动流（通知中心/活动面板）；按 id 倒序，附带任务标题与项目。 */
  listActivity(limit = 60): Array<CoworkEvent & { task_title: string; project_id: string | null }> {
    return queryActivity(this.db, limit);
  }

  // ── 任务 ──
  createTask(input: {
    title: string;
    objective: string;
    workspace_root: string;
    permission_mode?: string;
    project_id?: string | null;
    data_policy?: string;
    model_policy?: Record<string, unknown>;
    inputs?: Record<string, unknown>;
  }): CoworkTask {
    const title = input.title.trim();
    const objective = input.objective.trim();
    if (!title) throw new CoworkValidationError("任务标题不能为空");
    if (!objective) throw new CoworkValidationError("任务目标不能为空");
    const workspaceRoot = normalizeWorkspaceRoot(input.workspace_root);
    const project = input.project_id ? this.getProject(input.project_id) : null;
    if (project && JSON.parse(project.workspace_roots_json).length > 0) {
      const roots = JSON.parse(project.workspace_roots_json) as string[];
      const inside = roots.some((root) => {
        try {
          return isPathInside(fs.realpathSync(root), workspaceRoot);
        } catch {
          return false;
        }
      });
      if (!inside) {
        throw new CoworkValidationError("任务工作区必须位于项目工作区根内");
      }
    }
    const permissionMode = isPermissionMode(input.permission_mode)
      ? input.permission_mode
      : "operate";
    const dataPolicy = project?.data_policy === "local_only"
      ? "local_only"
      : input.data_policy === "cloud" || project?.data_policy === "cloud"
        ? "cloud"
        : "local_only";
    const modelPolicy = input.model_policy
      ? JSON.stringify(input.model_policy)
      : project?.model_policy_json ?? "{}";
    const id = crypto.randomUUID();
    const stagingRoot = coworkTaskStagingRoot(id);
    fs.mkdirSync(stagingRoot, { recursive: true });
    const createdAt = nowIso();
    const inputs: Record<string, unknown> = { ...(input.inputs ?? {}) };
    if (project) {
      inputs.project = {
        id: project.id,
        title: project.title,
        instructions: project.instructions,
        templates: JSON.parse(project.default_template_ids_json),
      };
    }
    this.db
      .query(
        `INSERT INTO cowork_tasks
          (id, project_id, title, objective, status, workspace_root, staging_root,
           permission_mode, model_policy_json, data_policy, inputs_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        project?.id ?? null,
        title,
        objective,
        workspaceRoot,
        stagingRoot,
        permissionMode,
        modelPolicy,
        dataPolicy,
        JSON.stringify(inputs),
        createdAt,
        createdAt,
      );
    this.appendEvent(id, null, "cowork.task.created", {
      title,
      objective,
      workspace_root: workspaceRoot,
      project_id: project?.id ?? null,
    });
    return this.getTask(id);
  }

  getTask(taskId: string): CoworkTask {
    const row = this.db.query("SELECT * FROM cowork_tasks WHERE id = ?").get(taskId) as CoworkTask | null;
    if (!row) throw new CoworkNotFoundError(`任务不存在：${taskId}`);
    return row;
  }

  listTasks(projectId?: string): CoworkTask[] {
    if (projectId) {
      return this.db
        .query("SELECT * FROM cowork_tasks WHERE project_id = ? ORDER BY updated_at DESC")
        .all(projectId) as CoworkTask[];
    }
    return this.db
      .query("SELECT * FROM cowork_tasks ORDER BY updated_at DESC")
      .all() as CoworkTask[];
  }

  // ── 项目与资产（M3-B，实现在 cowork-project-store）──
  listProjects(): CoworkProject[] {
    return queryProjects(this.db);
  }

  getProject(projectId: string): CoworkProject {
    return getProjectRow(this.db, projectId);
  }

  createProject(input: {
    title: string;
    instructions?: string;
    workspace_roots?: unknown;
    default_template_ids?: unknown;
    model_policy?: Record<string, unknown>;
    data_policy?: string;
  }): CoworkProject {
    return createProjectRow(this.db, input);
  }

  updateProject(projectId: string, patch: {
    title?: string;
    instructions?: string;
    workspace_roots?: unknown;
    default_template_ids?: unknown;
    model_policy?: Record<string, unknown>;
    data_policy?: string;
  }): CoworkProject {
    return updateProjectRow(this.db, projectId, patch);
  }

  listProjectAssets(projectId: string): CoworkProjectAsset[] {
    return queryProjectAssets(this.db, projectId);
  }

  addProjectAsset(projectId: string, input: { path: string; label?: string }): CoworkProjectAsset {
    return addProjectAssetRow(this.db, projectId, input);
  }

  getProjectAsset(projectId: string, assetId: string): CoworkProjectAsset {
    return getProjectAssetRow(this.db, projectId, assetId);
  }

  removeProjectAsset(projectId: string, assetId: string): void {
    removeProjectAssetRow(this.db, projectId, assetId);
  }

  attachAssetToTask(projectId: string, assetId: string, taskId: string): CoworkTask {
    const ctx: CoworkProjectContext = {
      db: this.db,
      getTask: (id) => this.getTask(id),
      appendEvent: (taskIdValue, runId, type, payload) => this.appendEvent(taskIdValue, runId, type, payload),
    };
    return attachProjectAssetToTask(ctx, projectId, assetId, taskId);
  }

  listProjectEvents(projectId: string, limit = 50): Array<Record<string, unknown>> {
    return queryProjectEvents(projectId, limit);
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
      .query(
        "SELECT * FROM cowork_artifacts WHERE task_id = ? AND status != 'deleted' ORDER BY created_at DESC",
      )
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
    return recoverTasks({
      db: this.db,
      getLatestRun: (taskId) => this.getLatestRun(taskId),
      getPendingApprovals: (taskId) => this.getPendingApprovals(taskId),
      updateRunStatus: (runId, status, patch) => this.updateRunStatus(runId, status, patch),
      getSteps: (runId) => this.getSteps(runId),
      resolveApproval: (approvalId, status, reason) => this.resolveApproval(approvalId, status, reason),
      appendEvent: (taskId, runId, type, payload) => this.appendEvent(taskId, runId, type, payload),
    });
  }
}
