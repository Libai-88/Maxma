/**
 * routes/deferred-runs.ts — 后台子任务状态追踪（api/routes/deferred_runs.py
 * 的 Bun 直译，阶段二 2.2h）。
 *
 * 数据：maxma.db deferred_runs 表（DEFERRED-PERSIST-001：重启不丢）。
 * addOrUpdate 由 2.3 的 WS 事件层调用；本文件提供 manager + 3 端点。
 *
 * ## 浏览器边界
 *
 * 表里只存运行状态（执行侧的 `task` / `name` 在写入前剥离）。HTTP 与 WS
 * 只能拿到 `toDeferredRunView()` 的白名单投影——ADR 0003 的「完整 prompt
 * 不进父级摘要/UI 缓存」由这里执行，而不是靠前端类型「看不见」。
 *
 * 列表默认不带 `result` 全文（只给 null），需要时走单条端点。否则每 4 秒的
 * 轮询会把所有子任务输出重复传一遍。
 */

import { Hono } from "hono";

import { withTransaction } from "../db/core";

type RunRecord = Record<string, unknown>;

/** 终态：一旦写入，不允许被后续事件改回活跃态（尤其 cancelled）。 */
const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

/** 列表默认返回的终态条数；活跃任务无论多老都会返回。 */
const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 200;

/** 每个会话保留的终态记录数，防止 deferred_runs 无限增长。 */
const RETAIN_TERMINAL_PER_SESSION = 200;

/** 把执行侧可能传来的字符串/空值收敛成有限数字。 */
function finiteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 浏览器可见的字段白名单。
 *
 * 新增字段时必须同步 web/src/types/session.ts 的 `DeferredRun`；反过来说，
 * 执行侧的 `task` / `name` / 任何凭据字段都不在这里——也就不可能被序列化出去。
 */
export function toDeferredRunView(run: RunRecord, opts: { includeResult?: boolean } = {}): RunRecord {
  const parentTurn = run.parent_turn_id
  return {
    run_id: String(run.run_id ?? ""),
    parent_turn_id: typeof parentTurn === "string" ? parentTurn : null,
    status: String(run.status ?? "queued"),
    result_ref: typeof run.result_ref === "string" ? run.result_ref : null,
    // 列表不带 result 全文；只有单条端点才展开。
    result:
      opts.includeResult === false || typeof run.result !== "string" ? null : run.result,
    cancel_reason: typeof run.cancel_reason === "string" ? run.cancel_reason : null,
    deadline_at:
      typeof run.deadline_at === "number" && Number.isFinite(run.deadline_at) ? run.deadline_at : null,
    attempts: finiteNumber(run.attempts),
    created_at: finiteNumber(run.created_at),
    updated_at: finiteNumber(run.updated_at),
    error_code: typeof run.error_code === "string" ? run.error_code : null,
    // 失败原因只用于界面提示，截断避免整段堆栈/内部路径塞进卡片。
    error_message:
      typeof run.error_message === "string" ? run.error_message.slice(0, 500) : null,
  };
}

function decode(raw: unknown): RunRecord | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(String(raw)) as unknown;
    return data && typeof data === "object" && !Array.isArray(data) ? (data as RunRecord) : null;
  } catch {
    return null;
  }
}

function isActive(run: RunRecord): boolean {
  return run.status === "queued" || run.status === "running";
}

/**
 * 取消意图的下发通道。
 *
 * `cancelRun()` 只负责把记录改成 cancelled（这是浏览器看到的事实）。真正
 * 停掉执行侧需要引擎配合；server.ts 通过这个钩子把 `cancel_deferred_run`
 * RPC 接进来。钩子失败不影响记录状态——最多是执行侧晚一点自己收尾。
 */
type CancelHandler = (sessionId: string, runId: string) => void | Promise<unknown>;

let cancelHandler: CancelHandler | null = null;

export function setDeferredRunCancelHandler(handler: CancelHandler | null): void {
  cancelHandler = handler;
}

export class DeferredRunManager {
  private getSync(sessionId: string, runId: string): RunRecord | null {
    const row = withTransaction((db) =>
      db
        .query("SELECT data FROM deferred_runs WHERE session_id = ? AND run_id = ?")
        .get(sessionId, runId) as { data: string } | undefined,
    );
    return decode(row?.data);
  }

  private listSync(sessionId: string): RunRecord[] {
    const rows = withTransaction((db) =>
      db.query("SELECT data FROM deferred_runs WHERE session_id = ?").all(sessionId) as Array<{ data: string }>,
    );
    return rows.map((r) => decode(r.data)).filter((r): r is RunRecord => r !== null);
  }

  private upsertSync(sessionId: string, run: RunRecord): void {
    withTransaction((db) => {
      db.query(
        "INSERT INTO deferred_runs (session_id, run_id, data) VALUES (?, ?, ?) ON CONFLICT(session_id, run_id) DO UPDATE SET data = excluded.data, updated_at = julianday('now')",
      ).run(sessionId, String(run.run_id ?? ""), JSON.stringify(run));
    });
  }

  private deleteSync(sessionId: string, runIds: string[]): void {
    if (runIds.length === 0) return;
    withTransaction((db) => {
      const stmt = db.query("DELETE FROM deferred_runs WHERE session_id = ? AND run_id = ?");
      for (const runId of runIds) stmt.run(sessionId, runId);
    });
  }

  addOrUpdate(sessionId: string, run: RunRecord): RunRecord {
    const runId = run.run_id;
    if (!runId) throw new Error("run_id is required");
    const existing = this.getSync(sessionId, String(runId)) ?? {};
    const merged = { ...existing, ...run };

    // 终态不可逆：迟到的 succeeded/failed 事件不能把 cancelled 冲掉，否则
    // 用户点过取消的任务会在下一帧「复活」。重试应使用新的 run_id。
    if (TERMINAL.has(String(existing.status)) && run.status !== undefined) {
      merged.status = existing.status;
      if (existing.status === "cancelled") {
        merged.cancel_reason = existing.cancel_reason ?? merged.cancel_reason;
      }
    }

    // 执行侧的完整 prompt / 子任务标题不进入父级数据面：即使调用方
    // 误传，也在落库前剥掉（老的遗留行由读取投影兜底）。
    delete merged.task;
    delete merged.name;

    merged.updated_at = Math.floor(Date.now() / 1000);
    if (merged.created_at == null) merged.created_at = merged.updated_at;
    this.upsertSync(sessionId, merged);

    if (TERMINAL.has(String(merged.status))) this.pruneSync(sessionId);
    return { ...merged };
  }

  /**
   * 超时兜底：执行侧崩溃/断连时不会再有事件，记录会永远停在 running。
   * 列表/单条读取时惰性扫描，把过期记录落成 failed，避免前端无限轮询。
   */
  private sweepExpiredSync(sessionId: string, nowSec = Math.floor(Date.now() / 1000)): void {
    for (const run of this.listSync(sessionId)) {
      if (!isActive(run)) continue;
      const deadline = Number(run.deadline_at ?? 0);
      if (!Number.isFinite(deadline) || deadline <= 0 || deadline > nowSec) continue;
      run.status = "failed";
      run.error_code = "timeout";
      run.error_message = "任务超过截止时间仍未返回结果";
      run.updated_at = nowSec;
      this.upsertSync(sessionId, run);
    }
  }

  /** 只保留本会话最新的 N 条终态记录；活跃任务永不裁剪。 */
  private pruneSync(sessionId: string): void {
    const runs = this.listSync(sessionId);
    const terminal = runs
      .filter((r) => !isActive(r))
      .sort((a, b) => Number(b.updated_at ?? 0) - Number(a.updated_at ?? 0));
    const stale = terminal.slice(RETAIN_TERMINAL_PER_SESSION).map((r) => String(r.run_id));
    this.deleteSync(sessionId, stale);
  }

  listRuns(sessionId: string): RunRecord[] {
    this.sweepExpiredSync(sessionId);
    return this.listSync(sessionId).sort(
      (a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0),
    );
  }

  /**
   * 列表页：活跃任务全量返回，终态任务最多 `limit` 条（按创建时间倒序）。
   * 这样长会话不会把整份历史塞进一次响应，正在跑的任务又不会被裁掉。
   */
  listPage(sessionId: string, limit = DEFAULT_LIST_LIMIT): { runs: RunRecord[]; hasMore: boolean } {
    const all = this.listRuns(sessionId);
    const active = all.filter(isActive);
    const terminal = all.filter((r) => !isActive(r));
    const bounded = Math.max(1, Math.min(Math.floor(limit), MAX_LIST_LIMIT));
    const kept = terminal.slice(0, bounded);
    return {
      runs: [...active, ...kept].sort(
        (a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0),
      ),
      hasMore: terminal.length > kept.length,
    };
  }

  getRun(sessionId: string, runId: string): RunRecord | null {
    this.sweepExpiredSync(sessionId);
    const run = this.getSync(sessionId, runId);
    return run ? { ...run } : null;
  }

  cancelRun(sessionId: string, runId: string): RunRecord {
    const run = this.getSync(sessionId, runId);
    if (!run) {
      throw Object.assign(new Error("Deferred run not found"), { status: 404 });
    }
    if (TERMINAL.has(String(run.status))) {
      throw Object.assign(new Error(`Run already in terminal state: ${run.status}`), { status: 409 });
    }
    run.status = "cancelled";
    run.cancel_reason = "cancelled_by_user";
    run.cancel_requested_at = Math.floor(Date.now() / 1000);
    run.updated_at = run.cancel_requested_at;
    this.upsertSync(sessionId, run);

    // best-effort：把取消意图送到执行侧；失败不改变本地记录。
    if (cancelHandler) {
      try {
        void Promise.resolve(cancelHandler(sessionId, runId)).catch(() => {});
      } catch {
        /* ignore */
      }
    }
    return { ...run };
  }

  cancelParent(sessionId: string): void {
    const now = Math.floor(Date.now() / 1000);
    for (const run of this.listSync(sessionId)) {
      if (isActive(run)) {
        run.status = "cancelled";
        run.cancel_reason = "parent_session_closed";
        run.updated_at = now;
        this.upsertSync(sessionId, run);
      }
    }
  }

  /** 会话删除：记录一并删除，避免孤儿行永久占用空间。 */
  deleteSession(sessionId: string): void {
    withTransaction((db) => {
      db.query("DELETE FROM deferred_runs WHERE session_id = ?").run(sessionId);
    });
  }
}

/** 全局 manager 单例（WS 事件层 2.3 接线写入）。 */
const manager = new DeferredRunManager();
export function getDeferredRunManager(): DeferredRunManager {
  return manager;
}

export function createDeferredRunRoutes(): Hono {
  const app = new Hono();
  const mgr = () => getDeferredRunManager();

  app.get("/api/sessions/:sessionId/deferred-runs", (c) => {
    const raw = Number(c.req.query("limit"));
    const limit = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LIST_LIMIT;
    const { runs, hasMore } = mgr().listPage(c.req.param("sessionId"), limit);
    return c.json({
      runs: runs.map((run) => toDeferredRunView(run, { includeResult: false })),
      has_more: hasMore,
    });
  });

  app.get("/api/sessions/:sessionId/deferred-runs/:runId", (c) => {
    const run = mgr().getRun(c.req.param("sessionId"), c.req.param("runId"));
    if (!run) return c.json({ detail: "Deferred run not found" }, 404);
    return c.json(toDeferredRunView(run, { includeResult: true }));
  });

  app.post("/api/sessions/:sessionId/deferred-runs/:runId/cancel", (c) => {
    try {
      const run = mgr().cancelRun(c.req.param("sessionId"), c.req.param("runId"));
      return c.json(toDeferredRunView(run, { includeResult: true }));
    } catch (err) {
      const e = err as { status?: number; message?: string };
      const status = e.status === 404 ? 404 : e.status === 409 ? 409 : 500;
      return c.json({ detail: e.message ?? String(err) }, status);
    }
  });

  return app;
}
