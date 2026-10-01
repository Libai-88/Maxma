/**
 * routes/restart.ts — 重启后端进程（api/routes/restart.py 的 Bun 直译，
 * 阶段二 2.5a）。
 *
 * 语义对齐：
 *   - 打包/托管形态（MAXMA_BACKEND_COMPILED=1，有父进程监控）：仅退出，
 *     由父进程（启动器/Tauri）重新拉起，避免双后端竞争端口。
 *   - 开发形态：spawn 新的 `bun run src/server.ts`（新控制台）后退出。
 */

import { Hono } from "hono";
import * as path from "node:path";

import { record as recordActivity } from "../activity-hub";

export function createRestartRoutes(): Hono {
  const app = new Hono();

  app.post("/api/restart", (c) => {
    recordActivity("system", "restart", { message: "后端服务重启" });

    const compiled = process.env.MAXMA_BACKEND_COMPILED === "1";
    if (compiled) {
      // 打包形态：父进程监控负责重新拉起
      setTimeout(() => process.exit(0), 100);
      return c.json({ status: "restarting" });
    }

    // 开发形态：重新 spawn 自身（对齐 Python dev 分支）
    try {
      const scriptPath = path.resolve(import.meta.dir, "..", "server.ts");
      const proc = Bun.spawn([process.execPath, "run", scriptPath], {
        cwd: process.cwd(),
        stdio: ["ignore", "ignore", "ignore"],
        detached: true,
        env: { ...process.env },
      });
      proc.unref();
    } catch (err) {
      return c.json({ detail: `重启失败：${String(err)}` }, 500);
    }

    // 等子进程完成初始化（端口监听就绪）后再退出当前进程
    setTimeout(() => process.exit(0), 500);
    return c.json({ status: "restarting" });
  });

  return app;
}
