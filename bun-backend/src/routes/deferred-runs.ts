/**
 * routes/deferred-runs.ts — 后台子任务状态追踪（api/routes/deferred_runs.py
 * 的 Bun 直译，阶段二 2.2h）。
 *
 * 数据：maxma.db deferred_runs 表（DEFERRED-PERSIST-001：重启不丢）。
 * addOrUpdate 由 2.3 的 WS 事件层调用；本文件提供 manager + 3 端点。
 */

import { Hono } from "hono";

import { withTransaction } from "../db/core";

type RunRecord = Record<string, unknown>;

function decode(raw: unknown): RunRecord | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(String(raw)) as unknown;
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
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

  addOrUpdate(sessionId: string, run: RunRecord): RunRecord {
    const runId = run.run_id;
    if (!runId) throw new Error("run_id is required");
    const existing = this.getSync(sessionId, String(runId)) ?? {};
    const merged = { ...existing, ...run };
    merged.updated_at = Math.floor(Date.now() / 1000);
    if (!("created_at" in merged)) merged.created_at = merged.updated_at;
    this.upsertSync(sessionId, merged);
    return { ...merged };
  }

  listRuns(sessionId: string): RunRecord[] {
    return this.listSync(sessionId).sort(
      (a, b) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0),
    );
  }

  getRun(sessionId: string, runId: string): RunRecord | null {
    const run = this.getSync(sessionId, runId);
    return run ? { ...run } : null;
  }

  cancelRun(sessionId: string, runId: string): RunRecord {
    const run = this.getSync(sessionId, runId);
    if (!run) {
      throw Object.assign(new Error("Deferred run not found"), { status: 404 });
    }
    if (["succeeded", "failed", "cancelled"].includes(String(run.status))) {
      throw Object.assign(new Error(`Run already in terminal state: ${run.status}`), { status: 409 });
    }
    run.status = "cancelled";
    run.cancel_reason = "cancelled_by_user";
    run.updated_at = Math.floor(Date.now() / 1000);
    this.upsertSync(sessionId, run);
    return { ...run };
  }

  cancelParent(sessionId: string): void {
    const now = Math.floor(Date.now() / 1000);
    for (const run of this.listSync(sessionId)) {
      if (["queued", "running"].includes(String(run.status))) {
        run.status = "cancelled";
        run.cancel_reason = "parent_session_closed";
        run.updated_at = now;
        this.upsertSync(sessionId, run);
      }
    }
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
    return c.json({ runs: mgr().listRuns(c.req.param("sessionId")) });
  });

  app.get("/api/sessions/:sessionId/deferred-runs/:runId", (c) => {
    const run = mgr().getRun(c.req.param("sessionId"), c.req.param("runId"));
    if (!run) return c.json({ detail: "Deferred run not found" }, 404);
    return c.json(run);
  });

  app.post("/api/sessions/:sessionId/deferred-runs/:runId/cancel", (c) => {
    try {
      const run = mgr().cancelRun(c.req.param("sessionId"), c.req.param("runId"));
      return c.json(run);
    } catch (err) {
      const e = err as { status?: number; message?: string };
      return c.json({ detail: e.message ?? String(err) }, e.status ?? 500);
    }
  });

  return app;
}
