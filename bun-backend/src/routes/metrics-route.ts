/**
 * routes/metrics-route.ts — 指标查询（api/routes/metrics.py 的 Bun 直译）。
 *
 * GET /api/metrics → 当前快照
 * GET /api/metrics/history?window=3600 → 持久化历史（按时间升序）
 */

import { Hono } from "hono";

import { getMetrics } from "../metrics";

export function createMetricsRoutes(): Hono {
  const app = new Hono();

  app.get("/api/metrics", (c) => c.json(getMetrics().getSnapshot()));

  app.get("/api/metrics/history", (c) => {
    let window = 3600;
    const raw = c.req.query("window");
    if (raw !== undefined) {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 1) window = Math.floor(n);
    }
    const snapshots = getMetrics().getHistory(window);
    return c.json({ window_seconds: window, snapshots });
  });

  return app;
}
