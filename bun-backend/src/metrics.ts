/**
 * metrics.ts — 运行时指标单例（api/metrics.py 的 Bun 直译，阶段二 2.1）。
 *
 * 契约对齐要点：
 *   - get_snapshot() 输出形状逐字段对齐 Python 版（http/tools/llm/errors）
 *   - _Histogram.to_dict：{count, avg_ms, min_ms, max_ms}（空桶全 0）
 *   - 持久化到 maxma.db `metrics_snapshots` 表（*_json 列），schema 与
 *     api/db/metrics.py 相同——双端同库互读
 *   - timestamp 使用本地时区 ISO 无 Z 后缀（Python datetime.now().isoformat()
 *     语义），get_history 的 cutoff 字符串比较才正确
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Database } from "bun:sqlite";

import { getApiDataDir } from "./app-paths";

// ── Histogram ──

class Histogram {
  count = 0;
  total = 0;
  minVal = Number.POSITIVE_INFINITY;
  maxVal = 0;

  observe(value: number): void {
    this.count += 1;
    this.total += value;
    if (value < this.minVal) this.minVal = value;
    if (value > this.maxVal) this.maxVal = value;
  }

  toDict(): Record<string, number> {
    if (this.count === 0) return { count: 0, avg_ms: 0, min_ms: 0, max_ms: 0 };
    return {
      count: this.count,
      avg_ms: Math.round((this.total / this.count) * 100) / 100,
      min_ms: Math.round(this.minVal * 100) / 100,
      max_ms: Math.round(this.maxVal * 100) / 100,
    };
  }
}

/** 本地时区 ISO（无 Z 后缀，微秒）——对齐 Python datetime.now().isoformat()。 */
export function localIso(now: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
    `T${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}.` +
    `${p(now.getMilliseconds() * 1000, 6)}`
  );
}

export interface MetricsSnapshot {
  uptime_seconds: number;
  http: {
    total_requests: number;
    status_codes: Record<string, number>;
    latency_ms: Record<string, number>;
    top_paths: Record<string, Record<string, number>>;
  };
  tools: {
    total_calls: number;
    total_errors: number;
    by_tool: Record<string, Record<string, unknown>>;
  };
  llm: {
    total_calls: number;
    total_tokens_in: number;
    total_tokens_out: number;
    latency_ms: Record<string, number>;
    by_model: Record<string, number>;
  };
  errors: Record<string, number>;
}

export class Metrics {
  private startedAt = performance.now();
  private httpTotal = 0;
  private httpStatus = new Map<number, number>();
  private httpLatency = new Histogram();
  private httpByPath = new Map<string, Histogram>();
  private toolCount = new Map<string, number>();
  private toolErrors = new Map<string, number>();
  private toolLatency = new Map<string, Histogram>();
  private llmCount = 0;
  private llmTokensIn = 0;
  private llmTokensOut = 0;
  private llmLatency = new Histogram();
  private llmByModel = new Map<string, number>();
  private errorCount = new Map<string, number>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  /** 路径归一化：UUID/纯数字段替换为 :id（对齐 Python _normalize_path）。 */
  static normalizePath(method: string, rawPath: string): string {
    const p = rawPath.split("?")[0]!;
    const parts: string[] = [];
    for (const part of p.replace(/^\/+|\/+$/g, "").split("/")) {
      if (!part) continue;
      if ((part.length === 36 && part.split("-").length === 5) || /^\d+$/.test(part)) {
        parts.push(":id");
      } else {
        parts.push(part);
      }
    }
    return `${method} /${parts.join("/")}`;
  }

  recordRequest(method: string, routePath: string, statusCode: number, durationMs: number): void {
    this.httpTotal += 1;
    this.httpStatus.set(statusCode, (this.httpStatus.get(statusCode) ?? 0) + 1);
    this.httpLatency.observe(durationMs);
    const key = Metrics.normalizePath(method, routePath);
    let hist = this.httpByPath.get(key);
    if (!hist) {
      hist = new Histogram();
      this.httpByPath.set(key, hist);
    }
    hist.observe(durationMs);
  }

  recordToolCall(toolName: string, latencyMs?: number, isError = false): void {
    this.toolCount.set(toolName, (this.toolCount.get(toolName) ?? 0) + 1);
    if (isError) this.toolErrors.set(toolName, (this.toolErrors.get(toolName) ?? 0) + 1);
    if (latencyMs !== undefined) {
      let hist = this.toolLatency.get(toolName);
      if (!hist) {
        hist = new Histogram();
        this.toolLatency.set(toolName, hist);
      }
      hist.observe(latencyMs);
    }
  }

  recordLlmCall(model: string, tokensIn: number, tokensOut: number, latencyMs: number): void {
    this.llmCount += 1;
    this.llmTokensIn += tokensIn;
    this.llmTokensOut += tokensOut;
    this.llmLatency.observe(latencyMs);
    this.llmByModel.set(model, (this.llmByModel.get(model) ?? 0) + 1);
  }

  recordError(category: string): void {
    this.errorCount.set(category, (this.errorCount.get(category) ?? 0) + 1);
  }

  recordRateLimit(scope = "http"): void {
    const key = `rate_limit_${scope}`;
    this.errorCount.set(key, (this.errorCount.get(key) ?? 0) + 1);
  }

  getSnapshot(): MetricsSnapshot {
    const uptime = (performance.now() - this.startedAt) / 1000;

    const byTool: Record<string, Record<string, unknown>> = {};
    for (const [name, count] of [...this.toolCount.entries()].sort((a, b) => b[1] - a[1])) {
      const entry: Record<string, unknown> = { count };
      const errs = this.toolErrors.get(name);
      if (errs !== undefined) entry.errors = errs;
      const lat = this.toolLatency.get(name);
      if (lat) entry.latency = lat.toDict();
      byTool[name] = entry;
    }

    const topPaths = [...this.httpByPath.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10);

    return {
      uptime_seconds: Math.round(uptime * 10) / 10,
      http: {
        total_requests: this.httpTotal,
        status_codes: Object.fromEntries([...this.httpStatus.entries()].sort((a, b) => a[0] - b[0])),
        latency_ms: this.httpLatency.toDict(),
        top_paths: Object.fromEntries(topPaths.map(([p, h]) => [p, h.toDict()])),
      },
      tools: {
        total_calls: [...this.toolCount.values()].reduce((a, b) => a + b, 0),
        total_errors: [...this.toolErrors.values()].reduce((a, b) => a + b, 0),
        by_tool: byTool,
      },
      llm: {
        total_calls: this.llmCount,
        total_tokens_in: this.llmTokensIn,
        total_tokens_out: this.llmTokensOut,
        latency_ms: this.llmLatency.toDict(),
        by_model: Object.fromEntries(this.llmByModel),
      },
      errors: Object.fromEntries(this.errorCount),
    };
  }

  // ── 持久化（maxma.db metrics_snapshots 表，schema 同 Python db/metrics.py）──

  private openDb(): Database {
    fs.mkdirSync(getApiDataDir(), { recursive: true });
    const db = new Database(path.join(getApiDataDir(), "maxma.db"));
    db.exec(
      `CREATE TABLE IF NOT EXISTS metrics_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        uptime_seconds REAL,
        http_json TEXT,
        tools_json TEXT,
        llm_json TEXT,
        errors_json TEXT
      )`,
    );
    return db;
  }

  persistSnapshot(now: Date = new Date()): void {
    const snapshot = this.getSnapshot();
    const db = this.openDb();
    try {
      db.query(
        "INSERT INTO metrics_snapshots (timestamp, uptime_seconds, http_json, tools_json, llm_json, errors_json) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        localIso(now),
        snapshot.uptime_seconds,
        JSON.stringify(snapshot.http),
        JSON.stringify(snapshot.tools),
        JSON.stringify(snapshot.llm),
        JSON.stringify(snapshot.errors),
      );
    } catch (err) {
      console.warn(`[metrics] 持久化快照失败: ${String(err)}`);
    } finally {
      db.close();
    }
  }

  getHistory(windowSeconds = 3600): Array<Record<string, unknown>> {
    const db = this.openDb();
    try {
      const cutoffDate = new Date(Date.now() - windowSeconds * 1000);
      const cutoff = localIso(cutoffDate);
      const rows = db
        .query(
          "SELECT id, timestamp, uptime_seconds, http_json, tools_json, llm_json, errors_json FROM metrics_snapshots WHERE timestamp >= ? ORDER BY timestamp ASC",
        )
        .all(cutoff) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        id: r.id,
        timestamp: r.timestamp,
        uptime_seconds: r.uptime_seconds,
        http: JSON.parse(String(r.http_json ?? "{}")),
        tools: JSON.parse(String(r.tools_json ?? "{}")),
        llm: JSON.parse(String(r.llm_json ?? "{}")),
        errors: JSON.parse(String(r.errors_json ?? "{}")),
      }));
    } catch (err) {
      console.warn(`[metrics] 读取历史快照失败: ${String(err)}`);
      return [];
    } finally {
      db.close();
    }
  }

  /** 后台定期 flush（对齐 start_flush_task，默认 60s）。 */
  startFlushTask(intervalSeconds = 60): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      try {
        this.persistSnapshot();
      } catch (err) {
        console.warn(`[metrics] 后台 flush 失败: ${String(err)}`);
      }
    }, intervalSeconds * 1000);
  }

  stopFlushTask(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
      this.persistSnapshot();
    }
  }

  reset(): void {
    this.startedAt = performance.now();
    this.httpTotal = 0;
    this.httpStatus.clear();
    this.httpLatency = new Histogram();
    this.httpByPath.clear();
    this.toolCount.clear();
    this.toolErrors.clear();
    this.toolLatency.clear();
    this.llmCount = 0;
    this.llmTokensIn = 0;
    this.llmTokensOut = 0;
    this.llmLatency = new Histogram();
    this.llmByModel.clear();
    this.errorCount.clear();
    try {
      const db = this.openDb();
      db.exec("DELETE FROM metrics_snapshots");
      db.close();
    } catch {
      // 容忍 DB 不可用
    }
  }
}

/** 全局单例（对齐 Python get_metrics()）。 */
let singleton: Metrics | null = null;
export function getMetrics(): Metrics {
  if (!singleton) singleton = new Metrics();
  return singleton;
}
