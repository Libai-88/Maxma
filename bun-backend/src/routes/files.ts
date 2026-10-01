/**
 * routes/files.ts — 本地文件服务（api/routes/files.py 的 Bun 等价，
 * 阶段二 2.5a）。
 *
 * select-file 决策（用户 2026-10-01 确认）：Python 版用 tkinter 弹服务器端
 * 桌面对话框——Web 形态下该能力本就无法工作（对话框弹在后端机器）。桩实现
 * 返回 {path:null}，与"用户取消对话框"同行为；前端 3 处调用方（附件菜单/
 * 设置页/拒止锚页）均已容忍 null，静默无操作。
 */

import { Hono } from "hono";

export function createFileRoutes(): Hono {
  const app = new Hono();

  app.get("/api/select-file", (c) => {
    void c.req.query("type"); // file / folder——桩不区分
    return c.json({ path: null });
  });

  return app;
}
