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
import { getActiveServer, gracefulShutdown } from "../server";
import { getMetrics } from "../metrics";

export function createRestartRoutes(): Hono {
  const app = new Hono();

  app.post("/api/restart", (c) => {
    recordActivity("system", "restart", { message: "后端服务重启" });

    const compiled = process.env.MAXMA_BACKEND_COMPILED === "1";
    if (compiled) {
      // 打包形态：父进程监控负责重新拉起。优雅收尾后再退（STABILITY-002）：
      // flush 指标快照、卸插件宿主，不留孤儿定时器。
      setTimeout(() => {
        void gracefulShutdown("restart").finally(() => process.exit(0));
      }, 100);
      return c.json({ status: "restarting" });
    }

    // 开发形态：先释放端口再 spawn 自身。
    // 此前是 spawn 后父进程拖 500ms 才 exit——子进程立刻绑 8000 必然
    // EADDRINUSE（无重试，直接崩）。STABILITY-003：先 server.stop() 放掉
    // 端口，子进程一次就能绑上；代价是约 1s 的重启窗口无服务。
    try {
      getActiveServer()?.stop(true);
      getMetrics().stopFlushTask();
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

    // 端口已释放，直接退出（不给新旧进程共存窗口，providers.yaml 的
    // 读-改-写也不会被两个进程并发踩）
    setTimeout(() => process.exit(0), 50);
    return c.json({ status: "restarting" });
  });

  return app;
}
