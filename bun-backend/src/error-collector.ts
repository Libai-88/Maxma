/**
 * error-collector.ts — 全局错误收集器（api/diagnostics.py 的 Bun 直译，
 * 阶段二 2.5b）。
 *
 * 收集来源：
 *   1. 内存环形缓冲区（MAX_IN_MEMORY=500）：HTTP 5xx/业务 4xx、工具错误、
 *      agent/sidecar 错误、未捕获异常。
 *   2. 日志文件扫描：maxma.log* 中 ERROR/CRITICAL/WARNING 条目 + frontend-diag.log
 *      （DIAG-COMPLETE-001 含 WARNING；DIAG-FRONTEND-001 纳入前端错误；
 *      DIAG-NOISE-001 跳过 401/403/404 常规噪音）。
 *
 * Bun 单线程事件循环——无需 threading.Lock；同步读写天然安全。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getLogsDir, dataDir, isPortable } from "./app-paths";
import { appVersion } from "./app-version";

export interface ErrorRecord {
  timestamp: string;
  level: string;
  category: string;
  message: string;
  trace_id?: string | null;
  session_id?: string | null;
  request_id?: string | null;
  logger_name?: string | null;
  exception?: string | null;
  extra: Record<string, unknown>;
  source_file?: string;
  source_line?: number;
  occurrence_count?: number;
  related_trace_ids?: string[];
}

/** 本地时间 "YYYY-MM-DD HH:MM:SS"（对齐 Python time.strftime + localtime）。 */
function localTimestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export class ErrorCollector {
  static readonly MAX_IN_MEMORY = 500;
  static readonly MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;
  private buffer: ErrorRecord[] = [];
  private startedAt = Date.now() / 1000;

  private archivePath(): string {
    return path.join(getLogsDir(), "diagnostics.jsonl");
  }

  private appendArchive(record: ErrorRecord): void {
    try {
      const file = this.archivePath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file) && fs.statSync(file).size >= ErrorCollector.MAX_ARCHIVE_BYTES) {
        const previous = `${file}.1`;
        try { fs.rmSync(previous, { force: true }); } catch { /* best-effort rotation */ }
        fs.renameSync(file, previous);
      }
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
    } catch {
      // Persistent diagnostics are best-effort and must not interrupt application work.
    }
  }

  add(record: ErrorRecord): void {
    this.buffer.push(record);
    if (this.buffer.length > ErrorCollector.MAX_IN_MEMORY) this.buffer.shift();
    this.appendArchive(record);
  }

  addError(
    level: string,
    category: string,
    message: string,
    opts?: {
      trace_id?: string | null;
      session_id?: string | null;
      request_id?: string | null;
      logger_name?: string | null;
      exception?: string | null;
    } & Record<string, unknown>,
  ): void {
    const { trace_id, session_id, request_id, logger_name, exception, ...extra } = opts ?? {};
    this.add({
      timestamp: localTimestamp(new Date()),
      level,
      category,
      message,
      trace_id: trace_id ?? null,
      session_id: session_id ?? null,
      request_id: request_id ?? null,
      logger_name: logger_name ?? null,
      exception: exception ?? null,
      extra,
    });
  }

  getAll(): ErrorRecord[] {
    return this.buffer.slice();
  }

  clear(): number {
    const count = this.buffer.length;
    this.buffer = [];
    for (const file of [this.archivePath(), `${this.archivePath()}.1`]) {
      try { fs.rmSync(file, { force: true }); } catch { /* best-effort cleanup */ }
    }
    return count;
  }

  /** 扫描日志文件中的 ERROR/CRITICAL/WARNING 条目（兜底机制）。 */
  private scanLogFiles(): Array<Partial<ErrorRecord> & Record<string, unknown>> {
    const errors: Array<Partial<ErrorRecord> & Record<string, unknown>> = [];
    const logsDir = getLogsDir();
    const patterns = ["diagnostics.jsonl", "diagnostics.jsonl.1", "maxma.log", "maxma.log.1", "maxma.log.2", "maxma.log.3", "maxma.log.4", "maxma.log.5"];

    for (const pattern of patterns) {
      const logFile = path.join(logsDir, pattern);
      if (!fs.existsSync(logFile)) continue;
      let text: string;
      try {
        text = fs.readFileSync(logFile, "utf8");
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const line = lines[i]!.trim();
        if (!line) continue;
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          const level = String(entry.level ?? "");
          if (level === "ERROR" || level === "CRITICAL" || level === "WARNING") {
            const msg = String(entry.msg ?? entry.message ?? "");
            // DIAG-NOISE-001：401/403/404 常规噪音跳过
            if (["401", "403", "404"].some((code) => msg.includes(`→ ${code}`))) continue;
            const known = new Set(["timestamp", "ts", "level", "category", "message", "msg", "trace_id", "session_id", "request_id", "logger_name", "logger", "exception", "source_file", "source_line", "extra"]);
            const parsedExtra = entry.extra && typeof entry.extra === "object" && !Array.isArray(entry.extra)
              ? entry.extra as Record<string, unknown>
              : {};
            const extra = Object.fromEntries(Object.entries(entry).filter(([key]) => !known.has(key)));
            errors.push({
              timestamp: String(entry.ts ?? ""),
              level,
              category: String(entry.category ?? "log_file"),
              message: msg,
              logger_name: String(entry.logger_name ?? entry.logger ?? ""),
              session_id: (entry.session_id as string | undefined) ?? null,
              request_id: (entry.request_id as string | undefined) ?? null,
              trace_id: (entry.trace_id as string | undefined) ?? null,
              exception: (entry.exception as string | undefined) ?? null,
              extra: { ...parsedExtra, ...extra },
              source_file: pattern,
              source_line: lineNum,
            });
          }
        } catch {
          // 非 JSON 行（旧格式/损坏）——关键词匹配
          if (["ERROR", "CRITICAL", "WARNING"].some((k) => line.includes(k))) {
            errors.push({
              timestamp: "",
              level: "UNKNOWN",
              category: "log_file",
              message: line.slice(0, 500),
              source_file: pattern,
              source_line: lineNum,
            });
          }
        }
      }
    }

    // frontend-diag.log：逐行收集（非 JSON），只收错误类行
    const frontendLog = path.join(logsDir, "frontend-diag.log");
    if (fs.existsSync(frontendLog)) {
      const feKindRe = /^\[\d{2}:\d{2}:\d{2}\]\s+([^|]+?)\s*\|/;
      let text: string;
      try {
        text = fs.readFileSync(frontendLog, "utf8");
      } catch {
        text = "";
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const line = lines[i]!.trim();
        if (!line) continue;
        const m = feKindRe.exec(line);
        const kind = m ? m[1]!.trim() : "";
        let level: string;
        if (["error", "vue-error", "rejection"].includes(kind)) level = "ERROR";
        else if (["warn", "warning"].includes(kind)) level = "WARNING";
        else continue;
        const fields = line.split(" | ");
        const hasTrace = fields.length >= 4 && /^[a-z0-9-]{12,64}$/i.test(fields[2] ?? "");
        errors.push({
          timestamp: "",
          level,
          category: "frontend",
          message: (hasTrace ? fields.slice(3).join(" | ") : fields.slice(2).join(" | ")).slice(0, 12_000),
          logger_name: "frontend",
          ...(hasTrace ? { trace_id: fields[2] } : {}),
          ...(fields[1] ? { extra: { url: fields[1] } } : {}),
          source_file: "frontend-diag.log",
          source_line: lineNum,
        });
      }
    }

    return errors;
  }

  private collectAutonomyStatus(): Record<string, unknown> {
    // 自治层已移除（OMP 替代）
    return { available: false, reason: "Autonomy subsystem removed — OMP replaces it" };
  }

  private readTauriStartupLog(maxLines = 100): Record<string, unknown> {
    const tauriLogPath = path.join(getLogsDir(), "tauri.log");
    try {
      if (!fs.existsSync(tauriLogPath)) return { available: false, reason: "tauri.log 不存在" };
      let text: string;
      try {
        text = fs.readFileSync(tauriLogPath, "utf8");
      } catch (e) {
        return { available: false, reason: `读取失败: ${String(e)}` };
      }
      const all = text.split(/\r?\n/);
      // 对齐 Python deque(f, maxlen)：文件以 \n 分隔，末行可能为空——保留原样行集合尾部
      const tail = all.slice(-maxLines);
      return { available: true, path: tauriLogPath, line_count: tail.length, lines: tail };
    } catch (e) {
      return { available: false, reason: String(e) };
    }
  }

  /** 日志目录中所有日志文件信息（名称、大小、路径）。 */
  getLogFilesInfo(): Array<Record<string, unknown>> {
    const infoList: Array<Record<string, unknown>> = [];
    const logsDir = getLogsDir();
    try {
      if (!fs.existsSync(logsDir)) return infoList;
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
        const lower = name.toLowerCase();
        if (!lower.endsWith(".log") && !lower.endsWith(".jsonl") && lower !== "diagnostics.jsonl.1" && !lower.startsWith("maxma.log") && !lower.startsWith("tauri.log")) continue;
        let sizeBytes = 0;
        try {
          sizeBytes = stat.size;
        } catch {
          sizeBytes = 0;
        }
        infoList.push({
          name,
          size_bytes: sizeBytes,
          size_mb: Math.round((sizeBytes / (1024 * 1024)) * 100) / 100,
          path: full,
        });
      }
    } catch {
      // 收集失败返回已收集部分
    }
    return infoList;
  }

  private collectSystemInfo(): Record<string, unknown> {
    const info: Record<string, unknown> = {
      app_version: appVersion(),
      python_version: "N/A",
      bun_version: process.versions.bun ?? "N/A",
      node_compat_version: process.versions.node ?? "N/A",
      platform: `${os.type()} ${os.release()} ${os.arch()}`,
      os_name: process.platform,
      machine: os.machine(),
      processor: os.cpus()[0]?.model ?? "",
      process_id: process.pid,
      executable: process.execPath,
      uptime_seconds: Math.floor(Date.now() / 1000 - this.startedAt),
      logs_dir: getLogsDir(),
      data_dir: dataDir(),
    };
    try {
      info.cwd = process.cwd();
    } catch {
      info.cwd = "N/A";
    }
    info.is_frozen = isPortable();
    const envFlags: Record<string, string> = {};
    for (const key of ["MAXMA_ENV", "MAXMA_LOG_LEVEL", "MAXMA_LOG_JSON", "MAXMA_API_PORT"]) {
      const val = process.env[key];
      if (val !== undefined) envFlags[key] = val;
    }
    info.env_flags = envFlags;
    return info;
  }

  /** 生成完整错误报告（JSON 结构）。 */
  exportReport(): Record<string, unknown> {
    const memoryErrors = this.getAll();
    const fileErrors = this.scanLogFiles();
    const systemInfo = this.collectSystemInfo();

    // Trace ID 区分独立失败；相同错误的重复采集只聚合计数，不丢关联信息。
    const seen = new Map<string, Record<string, unknown>>();
    const merged: Array<Record<string, unknown>> = [];
    for (const err of [...memoryErrors, ...fileErrors] as Array<Record<string, unknown>>) {
      const traceId = String(err.trace_id ?? "");
      const key = traceId
        ? `trace:${traceId}`
        : [err.level, err.category, err.message, err.session_id, err.logger_name].map((v) => String(v ?? "")).join("|");
      const existing = seen.get(key);
      if (existing) {
        const sameTrace = traceId && traceId === String(existing.trace_id ?? "");
        const archiveCopyOfMemory = Boolean(err.source_file) && !Boolean(existing.source_file);
        if (!sameTrace && !archiveCopyOfMemory) {
          existing.occurrence_count = Number(existing.occurrence_count ?? 1) + 1;
        }
        const ids = new Set([...(existing.related_trace_ids as string[] | undefined ?? []), sameTrace ? "" : traceId].filter(Boolean));
        if (ids.size) existing.related_trace_ids = [...ids];
        continue;
      }
      const first = { ...err, occurrence_count: 1 };
      seen.set(key, first);
      merged.push(first);
    }
    // 按时间排序：Python `e.get("timestamp") or ""` 使空时间戳归一为 ""，
    // 升序排到最前（直译对齐代码实际行为，非注释所述"排到最后"）。
    merged.sort((a, b) => {
      const ta = String(a.timestamp ?? "");
      const tb = String(b.timestamp ?? "");
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

    return {
      generated_at: localTimestamp(new Date()),
      system_info: systemInfo,
      autonomy_status: this.collectAutonomyStatus(),
      tauri_startup_log: this.readTauriStartupLog(),
      errors: merged,
      stats: {
        memory_error_count: memoryErrors.length,
        log_file_error_count: fileErrors.length,
        merged_total: merged.length,
        uptime_seconds: Math.floor(Date.now() / 1000 - this.startedAt),
        buffer_capacity: ErrorCollector.MAX_IN_MEMORY,
      },
    };
  }

  /** 生成纯文本错误报告（便于复制粘贴反馈给开发者）。 */
  exportTextReport(): string {
    const report = this.exportReport();
    const lines: string[] = [];
    const bar = "=".repeat(72);
    const dash = "─".repeat(72);
    lines.push(bar);
    lines.push("MaxmaHere 错误报告");
    lines.push(bar);
    lines.push(`生成时间: ${String(report.generated_at)}`);
    lines.push("");

    const info = report.system_info as Record<string, unknown>;
    lines.push(dash);
    lines.push("【系统信息】");
    lines.push(dash);
    lines.push(`  应用版本:     ${String(info.app_version ?? "N/A")}`);
    lines.push(`  Python 版本:  ${String(info.python_version ?? "N/A")}`);
    lines.push(`  平台:         ${String(info.platform ?? "N/A")}`);
    lines.push(`  打包模式:     ${String(info.is_frozen ?? false)}`);
    lines.push(`  运行时长:     ${String(info.uptime_seconds ?? 0)} 秒`);
    lines.push(`  工作目录:     ${String(info.cwd ?? "N/A")}`);
    lines.push(`  日志目录:     ${String(info.logs_dir ?? "N/A")}`);
    lines.push(`  数据目录:     ${String(info.data_dir ?? "N/A")}`);
    lines.push("");

    const autonomy = (report.autonomy_status ?? {}) as Record<string, unknown>;
    lines.push(dash);
    lines.push("【自治层状态】");
    lines.push(dash);
    if (autonomy.available) {
      lines.push(`  调度器运行:   ${String(autonomy.running ?? false)}`);
      lines.push(`  最近 tick:    ${String(autonomy.last_tick_at ?? "N/A")}`);
      lines.push(`  tick 次数:    ${String(autonomy.tick_count ?? 0)}`);
      const summary = (autonomy.last_tick_report_summary ?? {}) as Record<string, unknown>;
      if (Object.keys(summary).length) {
        lines.push(`  上次问题数:   ${String(summary.issues_count ?? 0)}`);
        lines.push(`  上次错误数:   ${String(summary.error_total ?? 0)}`);
        lines.push(`  上次健康态:   ${String(summary.health_status ?? "N/A")}`);
      }
    } else {
      lines.push(`  不可用: ${String(autonomy.reason ?? "unknown")}`);
    }
    lines.push("");

    const tauri = (report.tauri_startup_log ?? {}) as Record<string, unknown>;
    lines.push(dash);
    lines.push("【Tauri 启动日志】");
    lines.push(dash);
    if (tauri.available) {
      lines.push(`  文件路径:     ${String(tauri.path ?? "N/A")}`);
      lines.push(`  行数:         ${String(tauri.line_count ?? 0)}`);
      lines.push("  内容（最后 100 行）:");
      for (const l of (tauri.lines as string[]) ?? []) lines.push(`    ${l}`);
    } else {
      lines.push(`  不可用: ${String(tauri.reason ?? "unknown")}`);
    }
    lines.push("");

    const stats = report.stats as Record<string, unknown>;
    lines.push(dash);
    lines.push("【错误统计】");
    lines.push(dash);
    lines.push(`  内存收集:     ${String(stats.memory_error_count)} 条`);
    lines.push(`  日志扫描:     ${String(stats.log_file_error_count)} 条`);
    lines.push(`  合并去重后:   ${String(stats.merged_total)} 条`);
    lines.push(`  缓冲区容量:   ${String(stats.buffer_capacity)} 条`);
    lines.push("");

    const errors = report.errors as Array<Record<string, unknown>>;
    if (!errors.length) {
      lines.push(dash);
      lines.push("【错误详情】");
      lines.push(dash);
      lines.push("  无错误记录 🎉");
      lines.push("");
    } else {
      errors.forEach((err, idx) => {
        const i = idx + 1;
        lines.push(dash);
        lines.push(`【错误 #${i}】`);
        lines.push(dash);
        lines.push(`  时间:     ${String(err.timestamp ?? "N/A")}`);
        lines.push(`  级别:     ${String(err.level ?? "N/A")}`);
        lines.push(`  类别:     ${String(err.category ?? "N/A")}`);
        lines.push(`  消息:     ${String(err.message ?? "N/A")}`);
        if (err.trace_id) lines.push(`  Trace ID: ${String(err.trace_id)}`);
        if (err.session_id) lines.push(`  会话 ID:  ${String(err.session_id)}`);
        if (err.request_id) lines.push(`  请求 ID:  ${String(err.request_id)}`);
        if (err.logger_name) lines.push(`  Logger:   ${String(err.logger_name)}`);
        if (err.source_file) lines.push(`  来源:     ${String(err.source_file)}:${String(err.source_line ?? "")}`);
        if (err.exception) {
          lines.push("  异常堆栈:");
          for (const tl of String(err.exception).split(/\r?\n/)) lines.push(`    ${tl}`);
        }
        const extra = err.extra as Record<string, unknown> | undefined;
        if (extra && Object.keys(extra).length) {
          lines.push("  附加信息:");
          for (const [k, v] of Object.entries(extra)) {
            const rendered = typeof v === "string" ? v : JSON.stringify(v);
            lines.push(`    ${k}: ${rendered ?? String(v)}`);
          }
        }
        if (Number(err.occurrence_count) > 1) lines.push(`  重复次数: ${String(err.occurrence_count)}`);
        if (Array.isArray(err.related_trace_ids) && err.related_trace_ids.length) {
          lines.push(`  关联 Trace: ${(err.related_trace_ids as string[]).join(", ")}`);
        }
        lines.push("");
      });
    }

    lines.push(bar);
    lines.push("报告结束");
    lines.push(bar);
    return lines.join("\n");
  }
}

let instance: ErrorCollector | null = null;

/** 全局单例（模块级快捷引用，对齐 Python error_collector）。 */
export function getErrorCollector(): ErrorCollector {
  if (!instance) instance = new ErrorCollector();
  return instance;
}
