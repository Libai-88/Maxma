/**
 * routes/diagnostics.ts — 诊断与错误日志导出（api/routes/diagnostics.py
 * 的 Bun 直译，阶段二 2.5b）。
 *
 * 端点：
 *   POST   /api/diagnostics/frontend        前端上报 → 追加 frontend-diag.log
 *   GET    /api/diagnostics/error-log       完整错误报告（JSON）
 *   GET    /api/diagnostics/error-log/text  纯文本报告（下载/复制）
 *   DELETE /api/diagnostics/error-log       清空内存缓冲区与诊断归档
 *   GET    /api/diagnostics/logs            日志文件列表及大小
 *   DELETE /api/diagnostics/logs            清理旧日志（保留三个活跃文件）
 */

import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";

import { getErrorCollector } from "../error-collector";
import { getLogsDir } from "../app-paths";

function frontendDiagLogPath(): string {
  return path.join(getLogsDir(), "frontend-diag.log");
}

/** 本地 [HH:MM:SS]（对齐 Python time.strftime('%H:%M:%S')）。 */
function clockStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function createDiagnosticsRoutes(): Hono {
  const app = new Hono();

  app.post("/api/diagnostics/frontend", async (c) => {
    try {
      const payload = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      fs.mkdirSync(getLogsDir(), { recursive: true });
      const kind = String(payload.kind ?? "") || "info";
      const msg = String(payload.msg ?? "").slice(0, 12_000);
      const url = String(payload.url ?? "").slice(0, 300);
      const traceId = String(payload.trace_id ?? "").slice(0, 64) || null;
      const inputDiagnostic = payload.diagnostic && typeof payload.diagnostic === "object" && !Array.isArray(payload.diagnostic)
        ? payload.diagnostic as Record<string, unknown>
        : {};
      const diagnostic: Record<string, unknown> = {};
      for (const key of ["name", "stack", "filename", "line", "column", "route", "user_agent", "viewport", "component_info"]) {
        const value = inputDiagnostic[key];
        if (typeof value === "string") diagnostic[key] = value.slice(0, key === "stack" ? 20_000 : 1000);
        else if (typeof value === "number" || typeof value === "boolean") diagnostic[key] = value;
      }
      const exception = typeof diagnostic.stack === "string" ? diagnostic.stack : null;
      delete diagnostic.stack;
      const level = ["error", "vue-error", "rejection"].includes(kind) ? "ERROR" : "WARNING";
      getErrorCollector().addError(level, "frontend", msg, {
        ...(traceId ? { trace_id: traceId } : {}),
        logger_name: "frontend",
        exception,
        url,
        kind,
        ...diagnostic,
      });
      const line = traceId
        ? `[${clockStamp(new Date())}] ${kind} | ${url} | ${traceId} | ${msg}\n`
        : `[${clockStamp(new Date())}] ${kind} | ${url} | ${msg}\n`;
      fs.appendFileSync(frontendDiagLogPath(), line, "utf8");
    } catch {
      // 诊断通道自身失败不影响主流程
    }
    return c.json({ status: "ok" });
  });

  app.get("/api/diagnostics/error-log", (c) => {
    return c.json(getErrorCollector().exportReport());
  });

  app.get("/api/diagnostics/error-log/text", (c) => {
    const text = getErrorCollector().exportTextReport();
    return new Response(text, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": 'attachment; filename="maxma-error-report.txt"',
      },
    });
  });

  app.delete("/api/diagnostics/error-log", (c) => {
    const deleted = getErrorCollector().clear();
    return c.json({ status: "ok", deleted });
  });

  app.get("/api/diagnostics/logs", (c) => {
    const files = getErrorCollector().getLogFilesInfo();
    const totalBytes = files.reduce((acc, f) => acc + Number(f.size_bytes ?? 0), 0);
    return c.json({
      status: "ok",
      logs_dir: getLogsDir(),
      files,
      count: files.length,
      total_bytes: totalBytes,
      total_mb: Math.round((totalBytes / (1024 * 1024)) * 100) / 100,
    });
  });

  app.delete("/api/diagnostics/logs", (c) => {
    const deletedFiles: Array<Record<string, unknown>> = [];
    let freedBytes = 0;
    const logsDir = getLogsDir();

    try {
      if (!fs.existsSync(logsDir)) {
        return c.json({
          status: "ok",
          deleted_count: 0,
          freed_bytes: 0,
          freed_mb: 0.0,
          deleted_files: [],
          message: "日志目录不存在",
        });
      }

      const protectedNames = new Set(["maxma.log", "tauri.log", "frontend-diag.log", "diagnostics.jsonl", "diagnostics.jsonl.1"]);
      const entries = fs.readdirSync(logsDir).sort((a, b) => a.localeCompare(b));

      for (const name of entries) {
        const full = path.join(logsDir, name);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        if (!stat.isFile()) continue;
        const nameLower = name.toLowerCase();
        if (protectedNames.has(nameLower)) continue;
        const isLogLike =
          nameLower.endsWith(".log") || nameLower.includes(".log.") || nameLower.endsWith(".log.old");
        if (!isLogLike) continue;

        let size = 0;
        try {
          size = stat.size;
        } catch {
          size = 0;
        }
        try {
          fs.rmSync(full, { force: true });
          deletedFiles.push({ name, size_bytes: size, path: full });
          freedBytes += size;
        } catch {
          // 删除失败跳过
        }
      }

      return c.json({
        status: "ok",
        deleted_count: deletedFiles.length,
        freed_bytes: freedBytes,
        freed_mb: Math.round((freedBytes / (1024 * 1024)) * 100) / 100,
        deleted_files: deletedFiles,
      });
    } catch (err) {
      return c.json({
        status: "error",
        error: String(err),
        deleted_count: deletedFiles.length,
        freed_bytes: freedBytes,
        freed_mb: Math.round((freedBytes / (1024 * 1024)) * 100) / 100,
        deleted_files: deletedFiles,
      });
    }
  });

  return app;
}
