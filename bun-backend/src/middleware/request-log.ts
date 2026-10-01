/**
 * middleware/request-log.ts — 请求日志 + 指标采集（api/middleware/request_log.py
 * + api/metrics.py 基础部分的 Bun 直译，2.0 版本仅记录到控制台与内存计数器）。
 *
 * Python 版在此处把方法/路径/状态码/耗时写入 Metrics 单例；完整 /api/metrics
 * 端点在阶段 2.1 落地，本文件先把采集点固化下来，保证切换后指标不丢。
 */

import type { Context, Next } from "hono";

import { getMetrics } from "../metrics";
import { getErrorCollector } from "../error-collector";

export interface RequestMetric {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  at: number;
}

/** 内存环形缓冲（避免长跑进程内存无界增长）。 */
const MAX_SAMPLES = 1000;
const samples: RequestMetric[] = [];
let requestCount = 0;
let errorCount = 0;

export function recordMetric(m: RequestMetric): void {
  requestCount += 1;
  if (m.status >= 400) errorCount += 1;
  samples.push(m);
  if (samples.length > MAX_SAMPLES) samples.shift();
}

export function metricsSnapshot() {
  return {
    requests: requestCount,
    errors: errorCount,
    samples: samples.slice(-100),
  };
}

export function resetMetrics(): void {
  samples.length = 0;
  requestCount = 0;
  errorCount = 0;
}

/** 不记录日志的路径（高频低价值，对齐 Python _SKIP_PATHS/_SKIP_PREFIXES）。 */
const SKIP_PATHS = new Set(["/api/health", "/favicon.ico"]);
const SKIP_PREFIXES = ["/assets/", "/static/"];

export async function requestLogMiddleware(c: Context, next: Next) {
  const started = performance.now();
  const method = c.req.method;
  const urlPath = new URL(c.req.url).pathname;

  // 跳过静态资源与健康检查：不采集指标、不打点（Python 同语义）
  if (SKIP_PATHS.has(urlPath) || SKIP_PREFIXES.some((p) => urlPath.startsWith(p))) {
    await next();
    return;
  }

  // request_id（Python uuid4().hex[:12]，X-Request-ID 响应头）
  const requestId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);

  await next();
  c.header("X-Request-ID", requestId);
  const durationMsRaw = performance.now() - started;
  const durationMs = Math.round(durationMsRaw);
  const durationMs1 = Math.round(durationMsRaw * 10) / 10;
  const status = c.res.status;
  // 指标采集（api/metrics.py record_request 平移，路径归一化在 Metrics 内做）
  getMetrics().recordRequest(method, urlPath, status, durationMs);
  // 与 Python 版一致：慢请求与错误请求打点，正常请求不刷屏
  if (status >= 400 || durationMs > 1000) {
    console.log(`[req] ${method} ${urlPath} ${status} ${durationMs}ms`);
  }
  // DIAG-WIRE-001：错误请求同步写入收集器（内存缓冲）——
  // 5xx→ERROR；4xx→WARNING（401/403/404 常规噪音跳过，否则 WARNING
  // 淹没真实错误信号，对齐 Python request_log.py 分支）。
  try {
    if (status >= 500) {
      getErrorCollector().addError("ERROR", "http", `${method} ${urlPath} → ${status}`, {
        request_id: requestId,
        logger_name: "middleware.request_log",
        duration_ms: durationMs1,
        status_code: status,
      });
    } else if (status >= 400 && status !== 401 && status !== 403 && status !== 404) {
      getErrorCollector().addError("WARNING", "http", `${method} ${urlPath} → ${status}`, {
        request_id: requestId,
        logger_name: "middleware.request_log",
        duration_ms: durationMs1,
        status_code: status,
      });
    }
  } catch {
    /* 收集器故障不影响主流程 */
  }
}
