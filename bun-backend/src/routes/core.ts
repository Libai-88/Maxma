/**
 * routes/core.ts — 核心路由（阶段二 2.0 脚手架，2.5b health 完整版）。
 *
 * /api/health：四部件健康报告（api/health.py get_health_report 直译，
 * probe_remote 语义对齐 Python 服务端硬编码 True——kernel in-process 适配
 * 见 src/health.ts）。
 * /api/auth/token：与 Python 同契约（前端 ensureTokenLoaded 运行时获取）。
 */

import { Hono } from "hono";

import { loadOrCreateToken, rotateToken } from "../auth";
import { getHealthReport, type HealthDeps } from "../health";

interface CoreDeps extends HealthDeps {
  version: string;
}

export function createCoreRoutes(deps: CoreDeps): Hono {
  const app = new Hono();

  app.get("/api/health", async (c) => {
    try {
      const report = await getHealthReport(deps);
      return c.json(report);
    } catch (err) {
      // 健康检查自身故障不应 500 崩溃前端轮询——回退 degraded 骨架
      console.warn(`[health] report failed: ${String(err)}`);
      return c.json({
        status: "degraded",
        version: deps.version,
        llm: { status: "error", detail: String(err) },
        memory: { status: "ok" },
        native_tools: { status: "ok" },
        mcp_tools: { status: "ok" },
        anthropic_skills_count: 0,
        timestamp: Date.now() / 1000,
      });
    }
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
