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
import { cors } from "hono/cors";

import { getWebDistDir } from "./app-paths";
import { buildCorsOrigins } from "./cors-config";
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
import { createSettingsPanelRoutes } from "./routes/settings-panels";
import { createWorkflowRoutes, setWorkflowEventSink } from "./routes/workflows";
import { createCollabRoutes } from "./routes/collab";
import { createDeferredRunRoutes } from "./routes/deferred-runs";
import { createActivityRoutes } from "./routes/activity";
import { createSessionCompressRoutes } from "./routes/session-compress";
import { createProvidersRoutes, migratePlaintextKeysToEncrypted } from "./routes/providers";
import { createBalanceRoutes } from "./routes/balance";
import { createMcpRoutes } from "./routes/mcp";
import { createMcpTestRoutes } from "./routes/mcp-test";
import { createToolsRoutes } from "./routes/tools";
import { createRestartRoutes } from "./routes/restart";
import { createUploadRoutes } from "./routes/upload";
import { createPluginsRoutes } from "./routes/plugins";
import { createFileRoutes } from "./routes/files";
import { createDiagnosticsRoutes } from "./routes/diagnostics";
import { createCapabilitiesRoutes } from "./routes/capabilities";
import { startBackgroundSync } from "./services/opencode-zen";
import { initializeDatabase } from "./db/core";
import { getMetrics } from "./metrics";
import { startLlmUsageRetentionTask } from "./llm-usage-ledger";
import { getApiDataDir } from "./app-paths";
import { record as recordActivity } from "./activity-hub";
import { send as rpcSend, sendError as rpcSendError, sendEvent as rpcSendEvent } from "./rpc";
import {
  handleChatMessage,
  onKernelEvent,
  registerChatConnection,
  unregisterChatConnection,
  type ChatWsHub,
  type WsData,
} from "./routes/chat-ws";

const VERSION = "2.0.0-stage2";
// 2.5d 默认切换：bun-backend 接管 8000（Python 默认端口）。灰度回退：
// MAXMA_BUN_PORT=8001 + 前端 MAXMA_API_BASE 指回 Python。
const PORT = Number(process.env.MAXMA_BUN_PORT ?? 8000);

/** 会话注册表与在途计划（供 sessions REST 门面与 WS 层共用）。 */
const hubSessions = new Map<string, PiSessionRecord>();
const hubPlans = new Map<string, PiPendingPlan>();
/** WS 连接注册表与幂等 id（chat WS 层）。 */
const wsConnections = new Map<string, Set<ServerWebSocket<WsData>>>();
const seenClientMsgIds = new Map<string, string[]>();

/** kernel 事件 → WS 广播原始出口（无连接时保留 stdout 便于诊断）。 */
function broadcastEvent(sessionId: string, event: { type: string; payload: Record<string, unknown> }): void {
  const conns = wsConnections.get(sessionId);
  if (conns && conns.size > 0) {
    const data = JSON.stringify(event);
    for (const ws of conns) {
      try {
        ws.send(data);
      } catch (err) {
        console.warn(`[ws] broadcast failed for ${sessionId.slice(0, 8)}: ${String(err)}`);
      }
    }
  } else {
    rpcSendEvent(sessionId, event);
  }
}

/** kernel 事件 → 回合富化层（2.3b：turn_id/截断/artifact/memory/deferred/埋点）。 */
function kernelEventSink(sessionId: string, event: { type: string; payload: Record<string, unknown> }): void {
  onKernelEvent(chatHub, sessionId, event);
}

/** 单请求作用域 RPC 调用（kernel in-process）。 */
function callKernelRpc(
  method: string,
  params: Record<string, unknown>,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const io = {
      send: (id: number | null, result: unknown) => resolve({ ok: true, result }),
      sendError: (_id: number | null, message: string) => resolve({ ok: false, error: message }),
      sendEvent: (sid: string, event: { type: string; payload: Record<string, unknown> }) =>
        kernelEventSink(sid, event),
    };
    const sid = params.session_id as string | undefined;
    if (method === "create_session") {
      void handlePiCreateSession(
        { io, sessions: hubSessions, pendingPlans: hubPlans },
        params,
        0,
      );
      return;
    }
    if (sid && hubSessions.has(sid)) {
      void handlePiSessionRpc({ io, sessions: hubSessions, pendingPlans: hubPlans }, method, sid, params, 0);
      return;
    }
    resolve({ ok: false, error: `Session not found: ${sid ?? "(missing)"}` });
  });
}

/** chat WS hub（message 分发 + 广播）。 */
const chatHub: ChatWsHub = {
  sessions: hubSessions,
  pendingPlans: hubPlans,
  connections: wsConnections,
  seenClientMsgIds,
  callRpc: callKernelRpc,
  broadcast: broadcastEvent,
};

export function createApp(): Hono {
  const token = loadOrCreateToken();
  // 数据库迁移（对齐 Python db/core.py import 时自动初始化：v1-v7 schema）
  initializeDatabase();
  const app = new Hono();

  // 中间件顺序与 Python 版一致：RequestLog -> RateLimit -> Auth -> CORS -> 路由
  // （Python add_middleware LIFO：后 add 先执行；CORS 最先 add → 最内层。
  // Auth 放行 OPTIONS，预检由 CORS 层返回 204。）
  app.use("*", requestLogMiddleware);
  app.use("*", createRateLimitMiddleware());
  app.use("*", createAuthMiddleware(() => token));
  const corsOrigins = new Set(buildCorsOrigins());
  app.use(
    "*",
    cors({
      origin: (o) => (o && corsOrigins.has(o) ? o : null),
      credentials: true,
      allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH", "OPTIONS"],
      // allowHeaders 空 → hono 回显 Access-Control-Request-Headers（对齐
      // Starlette allow_headers=["*"] + credentials 的反射行为）
      allowHeaders: [],
    }),
  );

  // 核心路由（2.0：health / auth token；2.5b：health 四部件完整版）
  app.route(
    "/",
    createCoreRoutes({
      version: VERSION,
      sessionIds: () => [...hubSessions.keys()],
      callRpc: callKernelRpc,
    }),
  );

  // 2.1 只读批：news / onboarding / metrics
  app.route("/", createNewsRoutes());
  app.route("/", createOnboardingRoutes());
  app.route("/", createMetricsRoutes());

  // 2.2 存储批：rules / maxma-blocker / settings / transcripts / memory / audit-log
  // 2.2 存储批：settings-panels 先于 memory 挂载——避免 memory 的
  // :memoryId 参数路由抢先匹配 /api/memory/hindsight-config（PANEL-ORDER-001）
  app.route("/", createSettingsPanelRoutes());
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

  // 2.2h：workflows / deferred-runs / collab
  app.route("/", createWorkflowRoutes());
  app.route("/", createDeferredRunRoutes());
  app.route("/", createCollabRoutes({ sessions: hubSessions }));

  // 2.3b：activity hub REST+SSE / session-compress
  app.route("/", createActivityRoutes());
  app.route("/", createSessionCompressRoutes({ sessions: hubSessions, callRpc: callKernelRpc }));

  // 2.4：providers / balance
  app.route("/", createProvidersRoutes());
  app.route("/", createBalanceRoutes());

  // 2.4b：MCP 系列（servers CRUD / registry / oauth / test-connection）
  app.route("/", createMcpRoutes({ sessions: hubSessions, callRpc: callKernelRpc }));
  app.route("/", createMcpTestRoutes());

  // 2.5a：tools / restart / upload / plugins 桩 / files 桩
  app.route("/", createToolsRoutes());
  app.route("/", createRestartRoutes());
  app.route("/", createUploadRoutes());
  app.route("/", createPluginsRoutes());
  app.route("/", createFileRoutes());

  // 2.5b：diagnostics（错误报告 + 前端诊断上报）
  app.route("/", createDiagnosticsRoutes());

  // 2.5c：capabilities 聚合 + skills/discovered 桩（endpoints 由 app.routes 派生）
  app.route(
    "/",
    createCapabilitiesRoutes({
      sessionCount: () => hubSessions.size,
      endpoints: () =>
        [...new Set(app.routes.filter((r) => r.path.startsWith("/api")).map((r) => r.path))].sort(),
    }),
  );

  // 2.3b：workflow WS 事件接线（kernel 直调路径不经回合富化层，原始广播）
  setWorkflowEventSink((sessionId, eventType, payload) => {
    broadcastEvent(sessionId, { type: eventType, payload });
  });

  // 2.2e 会话门面：REST /api/sessions → kernel（in-process）
  app.route(
    "/",
    createSessionsRoutes({
      hub: {
        // 2.3：事件出口经回合富化层广播（REST 调用经 callKernelRpc 的 Promise 拿结果）
        io: { send: rpcSend, sendError: rpcSendError, sendEvent: kernelEventSink },
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

  // 2.4 启动迁移（对齐 Python lifespan B-009：明文 api_key 就地加密，幂等）
  try {
    const n = migratePlaintextKeysToEncrypted();
    if (n > 0) console.info(`[providers] startup migration: encrypted ${n} plaintext api_key(s)`);
  } catch (err) {
    console.warn(`[providers] startup migration failed (non-fatal): ${String(err)}`);
  }

  // 2.4 内置免费供应商 + 后台周期同步（对齐 Python lifespan opencode-zen）
  try {
    startBackgroundSync();
  } catch (err) {
    console.warn(`[opencode-zen] startup injection failed (non-fatal): ${String(err)}`);
  }

  // 启动事件（对齐 Python server.py record_activity("system","startup")）
  recordActivity("system", "startup", { message: `MaxmaHere 后端启动完成 (${VERSION})` });

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
  startLlmUsageRetentionTask();
  return Bun.serve({
    port: PORT,
    async fetch(req, server) {
      const url = new URL(req.url);

      // ── WebSocket 升级：/ws/chat/{sid}（chat WS）+ 鉴权（X-Maxma-Token 或 subprotocol）──
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
        // 从路径提取 sessionId（Python 版路由 /ws/chat/{session_id}）
        const match = url.pathname.match(/^\/ws\/chat\/([^/]+)$/);
        if (!match) {
          return new Response("Unknown WS endpoint", { status: 404 });
        }
        const sessionId = decodeURIComponent(match[1]!);
        // 不传 headers：Bun 自动协商回显客户端请求的 subprotocol（token），
        // 与 Python 版 auth 中间件在 accept 时注入 subprotocol 同语义；
        // 传空对象 {} 会触发 Bun 的 upgrade headers 校验异常。
        const upgraded = server.upgrade(req, {
          data: { sessionId } satisfies WsData,
        });
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
      // ── chat WS 生命周期（2.3：kernel in-process 事件直连）──
      open(ws) {
        const data = ws.data as WsData;
        registerChatConnection(chatHub, data.sessionId, ws);
        console.info(`[ws] connected session=${data.sessionId.slice(0, 8)}`);
      },
      message(ws, raw) {
        const data = ws.data as WsData;
        // 消息分发（白名单 + 事件广播经 chatHub）
        handleChatMessage(chatHub, ws as unknown as ServerWebSocket<WsData>, raw);
        void data;
      },
      close(ws) {
        const data = ws.data as WsData;
        unregisterChatConnection(chatHub, data.sessionId, ws as unknown as ServerWebSocket<WsData>);
        console.info(`[ws] disconnected session=${data.sessionId.slice(0, 8)}`);
      },
    },
  });
}

if (import.meta.main || process.env.MAXMA_BACKEND_COMPILED === "1") {
  const server = startServer();
  console.log(`[bun-backend] listening on http://127.0.0.1:${server.port} (engine=bun-backend)`);
}
