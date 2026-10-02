/**
 * routes/metrics-route.ts — 指标查询（api/routes/metrics.py 的 Bun 直译）。
 *
 * GET /api/metrics → 当前快照
 * GET /api/metrics/history?window=3600 → 持久化历史（按时间升序）
 */

import { Hono } from "hono";

import { getMetrics } from "../metrics";
import { getLlmUsageSummary, getRecentLlmUsageCalls, startLlmUsageRetentionTask, LLM_USAGE_RETENTION_SECONDS } from "../llm-usage-ledger";

export function createMetricsRoutes(): Hono {
  const app = new Hono();
  startLlmUsageRetentionTask();

  app.get("/api/metrics", (c) => c.json(getMetrics().getSnapshot()));

  app.get("/api/metrics/llm-usage", (c) => {
    const rawWindow = c.req.query("window");
    const window = rawWindow === undefined ? 30 * 24 * 60 * 60 : Number(rawWindow);
    if (!Number.isFinite(window) || window < 1) return c.json({ error: "window must be a positive number of seconds" }, 400);
    const fromRaw = c.req.query("from");
    const toRaw = c.req.query("to");
    const from = fromRaw ? new Date(fromRaw) : undefined;
    const to = toRaw ? new Date(toRaw) : undefined;
    if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime()))) {
      return c.json({ error: "from and to must be valid date strings" }, 400);
    }
    if (from && to && from.getTime() >= to.getTime()) {
      return c.json({ error: "from must be earlier than to" }, 400);
    }
    const summary = getLlmUsageSummary({
      windowSeconds: Math.min(Math.floor(window), LLM_USAGE_RETENTION_SECONDS),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(c.req.query("provider") ? { provider: c.req.query("provider") } : {}),
      ...(c.req.query("model") ? { model: c.req.query("model") } : {}),
    });
    const recentCalls = getRecentLlmUsageCalls({
      windowSeconds: summary.window_seconds,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(c.req.query("provider") ? { provider: c.req.query("provider") } : {}),
      ...(c.req.query("model") ? { model: c.req.query("model") } : {}),
    }).slice(0, 100);
    return c.json({ ...summary, recent_calls: recentCalls });
  });
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
