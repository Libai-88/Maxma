/**
 * middleware/request-log.ts — 请求日志 + 指标采集（api/middleware/request_log.py
 * + api/metrics.py 基础部分的 Bun 直译，2.0 版本仅记录到控制台与内存计数器）。
 *
 * Python 版在此处把方法/路径/状态码/耗时写入 Metrics 单例；完整 /api/metrics
 * 端点在阶段 2.1 落地，本文件先把采集点固化下来，保证切换后指标不丢。
 */

import type { Context, Next } from "hono";

import { getMetrics } from "../metrics";

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

export async function requestLogMiddleware(c: Context, next: Next) {
  const started = performance.now();
  const method = c.req.method;
  const urlPath = new URL(c.req.url).pathname;
  await next();
  const durationMs = Math.round(performance.now() - started);
  const status = c.res.status;
  // 指标采集（api/metrics.py record_request 平移，路径归一化在 Metrics 内做）
  getMetrics().recordRequest(method, urlPath, status, durationMs);
  // 与 Python 版一致：慢请求与错误请求打点，正常请求不刷屏
  if (status >= 400 || durationMs > 1000) {
    console.log(`[req] ${method} ${urlPath} ${status} ${durationMs}ms`);
  }
}
