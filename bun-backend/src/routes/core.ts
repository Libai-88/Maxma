/**
 * routes/health.ts + routes/auth-token.ts — 阶段二 2.0 的最小可用面。
 *
 * /api/health：返回后端自身健康（版本/启动时长/引擎形态）。完整四部件探测
 * （模型/sidecar/凭据/存储）在阶段 2.1 对齐 Python api/health.py。
 * /api/auth/token：与 Python 同契约（前端 ensureTokenLoaded 运行时获取）。
 */

import { Hono } from "hono";

import { loadOrCreateToken, rotateToken } from "../auth";
import { metricsSnapshot } from "../middleware/request-log";

interface HealthDeps {
  version: string;
  startedAt: number;
  /** 引擎形态：阶段二初期为 "bun-backend"（kernel in-process 在 2.3 接入） */
  engine: string;
}

export function createCoreRoutes(deps: HealthDeps): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => {
    return c.json({
      status: "ok",
      version: deps.version,
      engine: deps.engine,
      uptime_seconds: Math.round((Date.now() - deps.startedAt) / 1000),
      // 与 Python 版一致：health 同时暴露轻量指标，供诊断面板读取
      metrics: metricsSnapshot(),
    });
  });

  app.get("/api/auth/token", (c) => {
    return c.json({ token: loadOrCreateToken() });
  });

  app.post("/api/auth/token/rotate", (c) => {
    // 与 Python 侧 rotate_token 同语义（前端重新获取后生效）
    return c.json({ token: rotateToken() });
  });

  return app;
}
