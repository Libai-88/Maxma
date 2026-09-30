/**
 * server.ts — Bun 后端入口（阶段二 2.0 脚手架）。
 *
 * 职责：Hono 装配（请求日志 → 限流 → 鉴权 → 路由）+ 前端静态托管
 * （WEB-HOST-001 平移）+ WebSocket 升级钩子（业务在阶段 2.3 接入）。
 *
 * 灰度原则：默认端口 8001，与 Python 后端（8000）并存；前端经
 * MAXMA_API_BASE 指向任一后端，任何时刻可秒回 Python。
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Hono } from "hono";

import { getWebDistDir } from "./app-paths";
import { loadOrCreateToken } from "./auth";
import { createAuthMiddleware, extractWsToken } from "./middleware/auth";
import {
  handlePiCreateSession,
  handlePiSessionRpc,
  type PiSessionRecord,
  type PiPendingPlan,
} from "../../bun-sidecar/src/kernel/bridge-pi";
import { createRateLimitMiddleware } from "./middleware/rate-limit";
import { requestLogMiddleware } from "./middleware/request-log";
import { createCoreRoutes } from "./routes/core";
import { createNewsRoutes } from "./routes/news";
import { createOnboardingRoutes } from "./routes/onboarding";
import { createMetricsRoutes } from "./routes/metrics-route";
import { createRulesRoutes } from "./routes/rules";
import { createMaxmaBlockerRoutes } from "./routes/maxma-blocker";
import { createSettingsRoutes } from "./routes/settings";
import { createTranscriptsRoutes } from "./routes/transcripts";
import { createMemoryRoutes } from "./routes/memory";
import { createAuditLogRoutes } from "./routes/audit-log";
import { createPersonaRoutes } from "./routes/persona";
import { createSessionsRoutes } from "./routes/sessions";
import { createStickerFileRoutes } from "./routes/stickers";
import { createStickerFavoritesRoutes } from "./routes/sticker-favorites";
import { createStickerUploadRoutes } from "./routes/sticker-upload";
import { getMetrics } from "./metrics";
import { getApiDataDir } from "./app-paths";
import { send as rpcSend, sendError as rpcSendError, sendEvent as rpcSendEvent } from "./rpc";

const VERSION = "2.0.0-stage2";
const PORT = Number(process.env.MAXMA_BUN_PORT ?? 8001);
const startedAt = Date.now();

/** 会话注册表与在途计划（供 sessions REST 门面与 WS 层共用）。 */
const hubSessions = new Map<string, PiSessionRecord>();
const hubPlans = new Map<string, PiPendingPlan>();

export function createApp(): Hono {
  const token = loadOrCreateToken();
  const app = new Hono();

  // 中间件顺序与 Python 版一致：RequestLog -> RateLimit -> Auth -> 路由
  app.use("*", requestLogMiddleware);
  app.use("*", createRateLimitMiddleware());
  app.use("*", createAuthMiddleware(() => token));

  // 核心路由（2.0：health / auth token）
  app.route("/", createCoreRoutes({ version: VERSION, startedAt, engine: "bun-backend" }));

  // 2.1 只读批：news / onboarding / metrics
  app.route("/", createNewsRoutes());
  app.route("/", createOnboardingRoutes());
  app.route("/", createMetricsRoutes());

  // 2.2 存储批：rules / maxma-blocker / settings / transcripts / memory / audit-log
  app.route("/", createRulesRoutes());
  app.route("/", createMaxmaBlockerRoutes());
  app.route("/", createSettingsRoutes());
  app.route("/", createTranscriptsRoutes());
  app.route("/", createMemoryRoutes());
  app.route("/", createAuditLogRoutes());
  app.route("/", createPersonaRoutes());
  app.route("/", createStickerFileRoutes());
  app.route("/", createStickerFavoritesRoutes());
  app.route("/", createStickerUploadRoutes());

  // 2.2e 会话门面：REST /api/sessions → kernel（in-process）
  app.route(
    "/",
    createSessionsRoutes({
      hub: {
        io: { send: rpcSend, sendError: rpcSendError, sendEvent: rpcSendEvent },
        sessions: hubSessions,
        pendingPlans: hubPlans,
      },
      audit: (type, target, targetId, detail) => {
        try {
          const file = path.join(getApiDataDir(), "audit_log.json");
          const records = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as unknown[]) : [];
          const now = new Date();
          const p = (n: number) => String(n).padStart(2, "0");
          const off = -now.getTimezoneOffset();
          const tz = `${off >= 0 ? "+" : "-"}${p(Math.floor(Math.abs(off) / 60))}${p(Math.abs(off) % 60)}`;
          records.push({
            timestamp: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}${tz}`,
            epoch: Math.floor(now.getTime() / 1000),
            type,
            target,
            target_id: targetId,
            detail,
            status: "ok",
          });
          fs.writeFileSync(file, JSON.stringify(records, null, 2), "utf8");
        } catch (err) {
          console.warn(`[audit] 写入审计日志失败: ${String(err)}`);
        }
      },
      version: VERSION,
    }),
  );

  // 指标后台 flush（对齐 Python start_flush_task，60s）
  getMetrics().startFlushTask(60);

  return app;
}

/** 静态文件（防目录穿越）；未命中返回 null 交由 SPA fallback 处理。 */
async function serveStaticFile(pathname: string, distDir: string): Promise<Response | null> {
  if (!fs.existsSync(path.join(distDir, "index.html"))) return null;
  const rel = pathname.replace(/^\/+/, "");
  const filePath = path.resolve(distDir, rel);
  if (filePath !== distDir && !filePath.startsWith(distDir + path.sep)) return null;
  try {
    const file = Bun.file(filePath);
    if (await file.exists()) return new Response(file);
  } catch {
    return null;
  }
  return null;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function withMime(res: Response, filePath: string): Response {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext];
  if (!type) return res;
  return new Response(res.body, { status: res.status, headers: { "content-type": type } });
}

/**
 * 非 API 路径的前端服务（静态文件 + SPA fallback）。
 * 独立导出供冒烟测试直测（不依赖端口绑定）；distDir 可注入（测试隔离）。
 */
export async function serveFrontend(pathname: string, distDir: string = getWebDistDir()): Promise<Response | null> {
  const staticRes = await serveStaticFile(pathname, distDir);
  if (staticRes) return withMime(staticRes, pathname);
  // SPA fallback（history 模式路由 / 根路径）
  const index = path.join(distDir, "index.html");
  if (fs.existsSync(index)) {
    return new Response(Bun.file(index), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return null;
}

const app = createApp();

/** 启动 HTTP/WS 监听（仅直接运行时调用；测试只 import createApp/serveFrontend）。 */
export function startServer() {
  return Bun.serve({
    port: PORT,
    async fetch(req, server) {
      const url = new URL(req.url);

      // ── WebSocket 升级（阶段 2.3 接入 chat WS；2.0 先完成鉴权契约）──
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        const protocols = (req.headers.get("sec-websocket-protocol") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const token = extractWsToken(req, protocols);
        if (!token || token !== loadOrCreateToken()) {
          // 与 Python 版一致：鉴权失败关闭码 4001
          return new Response("Unauthorized", { status: 401 });
        }
        const upgraded = server.upgrade(req, { data: { token } });
        if (!upgraded) return new Response("WebSocket upgrade failed", { status: 400 });
        return undefined as unknown as Response;
      }

      // ── 前端静态资源（WEB-HOST-001 平移）──
      if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/ws/")) {
        const frontendRes = await serveFrontend(url.pathname);
        if (frontendRes) return frontendRes;
      }

      return app.fetch(req);
    },
    websocket: {
      // 阶段 2.3 实现；2.0 仅保证握手后不崩
      message() {},
      close() {},
    },
  });
}

if (import.meta.main || process.env.MAXMA_BACKEND_COMPILED === "1") {
  const server = startServer();
  console.log(`[bun-backend] listening on http://127.0.0.1:${server.port} (engine=bun-backend)`);
}
