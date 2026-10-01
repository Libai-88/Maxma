/**
 * routes/activity.ts — Activity Hub REST + SSE（api/routes/activity.py 的
 * Bun 直译，阶段二 2.3b）。
 *
 * 端点：
 * - GET    /api/activity/recent  最近活动记录
 * - GET    /api/activity/stats   统计信息
 * - DELETE /api/activity         清空缓冲区
 * - GET    /api/activity/stream  SSE 流式推送
 *
 * SSE 实现差异：Python 版每 1s 轮询 deque（游标=时间戳）；Bun 单线程下改用
 * activity-hub.subscribe() 事件即时推送，游标语义保持（连接后只收新事件，
 * last_ts 初始化为当前时刻）。
 */

import { Hono } from "hono";

import { getActivityHub, type ActivityRecord } from "../activity-hub";

function sseFrame(record: ActivityRecord): string {
  return `event: activity\ndata: ${JSON.stringify(record)}\n\n`;
}

export function createActivityRoutes(): Hono {
  const app = new Hono();

  app.get("/api/activity/recent", (c) => {
    const limitRaw = c.req.query("limit");
    const limit = limitRaw !== undefined ? Number(limitRaw) : 100;
    const category = c.req.query("category") || undefined;
    const records = getActivityHub().recent(Number.isFinite(limit) ? limit : 100, category);
    return c.json({ records, total: records.length });
  });

  app.get("/api/activity/stats", (c) => {
    return c.json(getActivityHub().stats());
  });

  app.delete("/api/activity", (c) => {
    const count = getActivityHub().clear();
    return c.json({ cleared: count });
  });

  app.get("/api/activity/stream", (c) => {
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        unsubscribe = getActivityHub().subscribe((record) => {
          try {
            controller.enqueue(encoder.encode(sseFrame(record)));
          } catch {
            // 客户端已断开
          }
        });
        // 心跳注释行（与 SSE 规范兼容，防代理缓冲断连；前端忽略 ':' 开头行）
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            /* noop */
          }
        }, 15_000);
      },
      cancel() {
        if (unsubscribe) unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  });

  return app;
}
