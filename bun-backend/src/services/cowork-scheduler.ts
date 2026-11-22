/**
 * cowork-scheduler.ts — M3-C 本地定时调度。
 *
 * 边界：
 * - 只在后端进程运行时执行；应用关闭时明确不会运行。
 * - 单任务不重叠：任务处于计划/执行/待审批/暂停时，本次触发记为 skipped。
 * - 重启后按 missed_policy 处理：默认 `skip` 超过 24h 跳过；`run_once` 只补跑一次。
 * - 到期但未运行的旧触发不会排成队列反复轰炸；每次都会重算下一次。
 */

import * as crypto from "node:crypto";

import { Database } from "bun:sqlite";

import { getConnection } from "../db/core";
import { CoworkConflictError, CoworkNotFoundError, CoworkValidationError, type CoworkStore } from "./cowork-store";
import { nextCronRun, parseCron, validateTimezone } from "./cowork-cron";
import type { CoworkOrchestrator } from "./cowork-orchestrator";

const MAX_ACTIVE_SCHEDULES = 20;
const MISSED_SKIP_MS = 24 * 60 * 60_000;
const ACTIVE_TASK_STATUSES = ["planning", "awaiting_plan", "running", "awaiting_approval", "paused"];

export interface CoworkScheduleView {
  id: string;
  task_id: string;
  task_title: string;
  task_status: string;
  project_id: string | null;
  cron: string;
  timezone: string;
  enabled: number;
  missed_policy: string;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_task_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoworkSchedulerDeps {
  store: () => CoworkStore;
  orchestrator: () => CoworkOrchestrator;
  db?: Database;
  ownsDb?: boolean;
  /** 测试可缩短；生产 30 秒。 */
  tickMs?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class CoworkScheduler {
  private readonly deps: CoworkSchedulerDeps;
  private readonly ownsDb: boolean;
  private db: Database | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(deps: CoworkSchedulerDeps) {
    this.deps = deps;
    this.ownsDb = deps.ownsDb ?? !deps.db;
  }

  private connection(): Database {
    if (!this.db) this.db = this.deps.db ?? getConnection();
    return this.db;
  }

  close(): void {
    this.stop();
    if (this.db && this.ownsDb) this.db.close();
    this.db = null;
  }

  start(): void {
    if (this.timer) return;
    const tickMs = Math.max(1000, this.deps.tickMs ?? 30_000);
    this.timer = setInterval(() => { void this.tick(); }, tickMs);
    // 启动即补做一次“错过检查”；不是后台常驻队列。
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  list(projectId?: string): CoworkScheduleView[] {
    const base = `SELECT s.*, t.title AS task_title, t.status AS task_status, t.project_id AS project_id
      FROM cowork_schedules s JOIN cowork_tasks t ON t.id = s.task_id`;
    return projectId
      ? this.connection().query(`${base} WHERE t.project_id = ? ORDER BY s.created_at DESC`).all(projectId) as CoworkScheduleView[]
      : this.connection().query(`${base} ORDER BY s.created_at DESC`).all() as CoworkScheduleView[];
  }

  get(scheduleId: string): CoworkScheduleView {
    const row = this.connection()
      .query(`SELECT s.*, t.title AS task_title, t.status AS task_status, t.project_id AS project_id
        FROM cowork_schedules s JOIN cowork_tasks t ON t.id = s.task_id WHERE s.id = ?`)
      .get(scheduleId) as CoworkScheduleView | null;
    if (!row) throw new CoworkNotFoundError("定时任务不存在");
    return row;
  }

  create(input: {
    task_id: string;
    cron: string;
    timezone?: string;
    missed_policy?: string;
    enabled?: boolean;
  }): CoworkScheduleView {
    const store = this.deps.store();
    const task = store.getTask(input.task_id);
    const cron = input.cron.trim();
    const timezone = validateTimezone(input.timezone ?? "Asia/Shanghai");
    parseCron(cron);
    const missedPolicy = input.missed_policy === "run_once" ? "run_once" : "skip";
    const enabled = input.enabled === false ? 0 : 1;
    if (enabled) {
      const active = this.connection()
        .query("SELECT COUNT(*) AS count FROM cowork_schedules WHERE enabled = 1")
        .get() as { count: number };
      if (Number(active.count) >= MAX_ACTIVE_SCHEDULES) {
        throw new CoworkValidationError(`最多 ${MAX_ACTIVE_SCHEDULES} 个活动定时任务`);
      }
    }
    const next = nextCronRun(cron, timezone, new Date());
    if (!next) throw new CoworkValidationError("cron 在未来一年内没有触发时间");
    const id = crypto.randomUUID();
    const createdAt = nowIso();
    this.connection()
      .query(
        `INSERT INTO cowork_schedules
          (id, task_id, cron, timezone, enabled, next_run_at, last_run_at,
           missed_policy, last_status, last_error, last_task_run_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, ?, ?)`,
      )
      .run(id, task.id, cron, timezone, enabled, next.toISOString(), missedPolicy, createdAt, createdAt);
    this.appendTaskEvent(task.id, "cowork.schedule.created", {
      schedule_id: id,
      cron,
      timezone,
      next_run_at: next.toISOString(),
    });
    return this.get(id);
  }

  update(scheduleId: string, patch: {
    cron?: string;
    timezone?: string;
    missed_policy?: string;
    enabled?: boolean;
  }): CoworkScheduleView {
    const current = this.get(scheduleId);
    const cron = patch.cron === undefined ? current.cron : patch.cron.trim();
    const timezone = patch.timezone === undefined
      ? current.timezone
      : validateTimezone(patch.timezone);
    parseCron(cron);
    const missedPolicy = patch.missed_policy === undefined
      ? current.missed_policy
      : patch.missed_policy === "run_once" ? "run_once" : "skip";
    const enabled = patch.enabled === undefined ? current.enabled : patch.enabled ? 1 : 0;
    if (enabled && !current.enabled) {
      const active = this.connection()
        .query("SELECT COUNT(*) AS count FROM cowork_schedules WHERE enabled = 1")
        .get() as { count: number };
      if (Number(active.count) >= MAX_ACTIVE_SCHEDULES) {
        throw new CoworkValidationError(`最多 ${MAX_ACTIVE_SCHEDULES} 个活动定时任务`);
      }
    }
    const next = enabled ? nextCronRun(cron, timezone, new Date()) : null;
    this.connection()
      .query(
        `UPDATE cowork_schedules
         SET cron = ?, timezone = ?, missed_policy = ?, enabled = ?, next_run_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(cron, timezone, missedPolicy, enabled, next?.toISOString() ?? null, nowIso(), scheduleId);
    return this.get(scheduleId);
  }

  remove(scheduleId: string): void {
    const row = this.get(scheduleId);
    this.connection().query("DELETE FROM cowork_schedules WHERE id = ?").run(scheduleId);
    this.appendTaskEvent(row.task_id, "cowork.schedule.removed", { schedule_id: scheduleId });
  }

  /** 一次调度检查；测试可直接传入固定 now。 */
  async tick(now = new Date()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = this.connection()
        .query("SELECT id FROM cowork_schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?")
        .all(now.toISOString()) as Array<{ id: string }>;
      for (const row of due) {
        await this.runOne(row.id, now);
      }
    } finally {
      this.ticking = false;
    }
  }

  private async runOne(scheduleId: string, now: Date): Promise<void> {
    const schedule = this.get(scheduleId);
    const store = this.deps.store();
    let task;
    try {
      task = store.getTask(schedule.task_id);
    } catch {
      this.connection().query("UPDATE cowork_schedules SET enabled = 0, next_run_at = NULL WHERE id = ?").run(scheduleId);
      return;
    }

    const dueAt = schedule.next_run_at ? new Date(schedule.next_run_at) : now;
    const overdueMs = Math.max(0, now.getTime() - dueAt.getTime());
    const missedPolicy = schedule.missed_policy === "run_once" ? "run_once" : "skip";
    if (missedPolicy === "skip" && overdueMs > MISSED_SKIP_MS) {
      const next = nextCronRun(schedule.cron, schedule.timezone, now);
      this.record(scheduleId, {
        next_run_at: next?.toISOString() ?? null,
        last_run_at: schedule.last_run_at,
        last_status: "skipped_missed",
        last_error: null,
        last_task_run_id: schedule.last_task_run_id,
      });
      this.appendTaskEvent(task.id, "cowork.schedule.skipped", {
        schedule_id: scheduleId,
        reason: "missed_over_24h",
        overdue_ms: overdueMs,
      });
      return;
    }

    if (ACTIVE_TASK_STATUSES.includes(task.status)) {
      const next = nextCronRun(schedule.cron, schedule.timezone, now);
      this.record(scheduleId, {
        next_run_at: next?.toISOString() ?? null,
        last_run_at: schedule.last_run_at,
        last_status: "skipped_overlap",
        last_error: null,
        last_task_run_id: schedule.last_task_run_id,
      });
      this.appendTaskEvent(task.id, "cowork.schedule.skipped", {
        schedule_id: scheduleId,
        reason: "task_active",
        task_status: task.status,
      });
      return;
    }

    try {
      const result = await this.deps.orchestrator().startTask(task.id);
      const next = nextCronRun(schedule.cron, schedule.timezone, now);
      this.record(scheduleId, {
        next_run_at: next?.toISOString() ?? null,
        last_run_at: now.toISOString(),
        last_status: "triggered",
        last_error: null,
        last_task_run_id: result.run_id,
      });
      this.appendTaskEvent(task.id, "cowork.schedule.triggered", {
        schedule_id: scheduleId,
        run_id: result.run_id,
        cron: schedule.cron,
        timezone: schedule.timezone,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const next = nextCronRun(schedule.cron, schedule.timezone, now);
      this.record(scheduleId, {
        next_run_at: next?.toISOString() ?? null,
        last_run_at: schedule.last_run_at,
        last_status: err instanceof CoworkConflictError ? "skipped_overlap" : "failed",
        last_error: message.slice(0, 500),
        last_task_run_id: schedule.last_task_run_id,
      });
      this.appendTaskEvent(task.id, "cowork.schedule.failed", {
        schedule_id: scheduleId,
        error: message.slice(0, 500),
      });
    }
  }

  private record(scheduleId: string, patch: {
    next_run_at: string | null;
    last_run_at: string | null;
    last_status: string;
    last_error: string | null;
    last_task_run_id: string | null;
  }): void {
    this.connection()
      .query(
        `UPDATE cowork_schedules
         SET next_run_at = ?, last_run_at = ?, last_status = ?, last_error = ?, last_task_run_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.next_run_at,
        patch.last_run_at,
        patch.last_status,
        patch.last_error,
        patch.last_task_run_id,
        nowIso(),
        scheduleId,
      );
  }

  private appendTaskEvent(taskId: string, type: string, payload: Record<string, unknown>): void {
    try {
      this.deps.store().appendEvent(taskId, null, type, payload);
    } catch {
      // 调度状态已落库；事件失败不反滚触发结果。
    }
  }
}
