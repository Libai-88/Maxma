/**
 * cors-config.ts — CORS 来源构建（api/cors_config.py 的 Bun 直译，2.5d）。
 *
 * 开发环境仅放行 Vite 端口；生产额外加上后端自身 origin。
 * tauri:// 两条 origin 是上一代桌面壳遗留：Tauri 壳已移除，Electron 形态走
 * 后端自身 origin（下面的 production 分支），这两条已无真实消费方，
 * 但被 tests/routes-2.5.test.ts 锁住，删除属行为变更，另行处置。
 */

import { getAppSettings } from "./config-settings";

export function buildCorsOrigins(): string[] {
  const settings = getAppSettings();
  const apiPort = settings.maxma_api_port;
  const webPort = settings.maxma_web_port;

  const origins = [
    `http://localhost:${webPort}`,
    `http://127.0.0.1:${webPort}`,
    // Tauri v2 协议——开发和生成都需要
    "tauri://localhost",
    "https://tauri.localhost",
  ];
  if (process.env.MAXMA_ENV === "production") {
    origins.push(`http://localhost:${apiPort}`, `http://127.0.0.1:${apiPort}`);
  }
  return origins;
}
