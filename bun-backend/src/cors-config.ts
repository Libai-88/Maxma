/**
 * cors-config.ts — CORS 来源构建（api/cors_config.py 的 Bun 直译，2.5d）。
 *
 * 开发环境仅放行 Vite 端口；生产额外加上后端自身 origin。
 */

import { getAppSettings } from "./config-settings";

export function buildCorsOrigins(): string[] {
  const settings = getAppSettings();
  const apiPort = settings.maxma_api_port;
  const webPort = settings.maxma_web_port;

  const origins = [
    `http://localhost:${webPort}`,
    `http://127.0.0.1:${webPort}`,
  ];
  if (process.env.MAXMA_ENV === "production") {
    origins.push(`http://localhost:${apiPort}`, `http://127.0.0.1:${apiPort}`);
  }
  return origins;
}
