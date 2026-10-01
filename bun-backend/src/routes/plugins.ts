/**
 * routes/plugins.ts — 插件管理桩（api/routes/plugins.py 的 Bun 等价，
 * 阶段二 2.5a）。
 *
 * 决策（用户 2026-10-01 确认）：pi 内核无插件系统、kernel 零支持 plugin RPC，
 * Bun 侧无法提供真实插件能力 → **REST 桩化**：
 *   - GET /api/plugins → []（空态，前端插件面板显示"暂无可用插件"不报错）
 *   - GET /api/plugins/{name} → 404（无插件可查）
 *   - install/uninstall/toggle/config 写操作 → 501 {detail}（明确不可用）
 * 前端 PluginListView/DetailView/store 均对空列表与抛错有处理，UI 优雅降级。
 */

import { Hono } from "hono";

const UNAVAILABLE = "插件系统在当前引擎（pi 内核）不可用";

export function createPluginsRoutes(): Hono {
  const app = new Hono();

  app.get("/api/plugins", (c) => c.json([]));

  app.get("/api/plugins/:name", (c) =>
    c.json({ detail: `插件 '${c.req.param("name")}' 不存在` }, 404),
  );

  app.get("/api/plugins/:name/config", (c) =>
    c.json({ detail: `插件 '${c.req.param("name")}' 不存在` }, 404),
  );

  app.post("/api/plugins/install", (c) => c.json({ detail: UNAVAILABLE }, 501));

  app.delete("/api/plugins/:name", (c) => c.json({ detail: UNAVAILABLE }, 501));

  app.put("/api/plugins/:name/toggle", (c) => c.json({ detail: UNAVAILABLE }, 501));

  app.put("/api/plugins/:name/config", (c) => c.json({ detail: UNAVAILABLE }, 501));

  return app;
}
