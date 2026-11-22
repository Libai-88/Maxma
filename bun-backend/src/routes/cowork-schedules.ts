/**
 * routes/cowork-schedules.ts — M3-C 定时任务 REST。
 *
 * 只暴露本地调度器的配置面；实际触发由 CoworkScheduler 在应用进程内执行。
 */

import type { Context } from "hono";
import { Hono } from "hono";

import {
  CoworkConflictError,
  CoworkNotFoundError,
  CoworkValidationError,
} from "../services/cowork-store";
import { CRON_PRESETS } from "../services/cowork-cron";
import type { CoworkScheduler } from "../services/cowork-scheduler";

export interface CoworkScheduleRoutesDeps {
  scheduler: () => CoworkScheduler;
  enabled: () => boolean;
}

function errorResponse(c: Context, err: unknown): Response {
  if (err instanceof CoworkNotFoundError) return c.json({ detail: err.message }, 404);
  if (err instanceof CoworkConflictError) return c.json({ detail: err.message }, 409);
  if (err instanceof CoworkValidationError) return c.json({ detail: err.message }, 400);
  return c.json({ detail: err instanceof Error ? err.message : String(err) }, 400);
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function createCoworkScheduleRoutes(deps: CoworkScheduleRoutesDeps): Hono {
  const app = new Hono();
  const getScheduler = () => deps.scheduler();

  app.use("/api/cowork/schedules", async (c, next) => {
    if (!deps.enabled()) return c.json({ detail: "Cowork 任务层未启用" }, 503);
    await next();
  });
  app.use("/api/cowork/schedules/*", async (c, next) => {
    if (!deps.enabled()) return c.json({ detail: "Cowork 任务层未启用" }, 503);
    await next();
  });

  app.get("/api/cowork/schedules", (c) => {
    return c.json({
      schedules: getScheduler().list(c.req.query("project_id") || undefined),
      running: getScheduler().running,
      presets: CRON_PRESETS,
      note: "定时任务只在 Maxma 应用运行时执行；应用关闭时不会运行。",
    });
  });

  app.post("/api/cowork/schedules", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const taskId = text(body.task_id, 200);
      if (!taskId) throw new CoworkValidationError("task_id 不能为空");
      const schedule = getScheduler().create({
        task_id: taskId,
        cron: text(body.cron, 200),
        timezone: text(body.timezone, 80) || "Asia/Shanghai",
        missed_policy: text(body.missed_policy, 20),
        enabled: body.enabled !== false,
      });
      return c.json({ schedule }, 201);
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.patch("/api/cowork/schedules/:id", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const schedule = getScheduler().update(c.req.param("id"), {
        cron: body.cron === undefined ? undefined : text(body.cron, 200),
        timezone: body.timezone === undefined ? undefined : text(body.timezone, 80),
        missed_policy: body.missed_policy === undefined ? undefined : text(body.missed_policy, 20),
        enabled: body.enabled === undefined ? undefined : Boolean(body.enabled),
      });
      return c.json({ schedule });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  app.delete("/api/cowork/schedules/:id", (c) => {
    try {
      getScheduler().remove(c.req.param("id"));
      return c.json({ ok: true });
    } catch (err) {
      return errorResponse(c, err);
    }
  });

  return app;
}
