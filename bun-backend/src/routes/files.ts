/**
 * routes/files.ts — 文件选择桩的显式降级出口。
 *
 * 原生文件/文件夹选择必须发生在桌面壳（Electron dialog + preload），
 * 不能在后端进程里弹出一个用户看不到的对话框。Web 形态没有 preload 时，
 * 这里返回 501 + desktop_required，让前端显示明确原因；绝不再返回
 * {path:null} 这种与“用户取消”无法区分的静默结果。
 */

import { Hono } from "hono";

export function createFileRoutes(): Hono {
  const app = new Hono();

  app.get("/api/select-file", (c) => {
    return c.json(
      {
        path: null,
        reason: "desktop_required",
        message: "原生文件选择只在 Maxma 桌面端可用；Web 端请使用上传入口。",
      },
      501,
    );
  });

  return app;
}
