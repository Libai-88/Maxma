/**
 * kernel/agent-audit.ts — Agent 工具决策审计 + 写入前快照（M1 / T4）。
 *
 * 数据位置与后端 audit 路由一致：`<data>/api/data/agent_audit.jsonl`。
 * sidecar 与 backend 同进程但保持模块边界，不 import backend；只在
 * `MAXMA_DATA_DIR`（测试/便携）或 bundle root 下写这个固定相对路径。
 *
 * 快照只备份“已存在且可读的普通文件”，上限 8 MiB；新文件记录 existed=false，
 * 恢复时删除目标。审计写入失败不影响工具执行（best effort），但会在 stderr
 * 留下告警；不要把“写日志失败”误报成“工具失败”。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_AUDIT_BYTES = 16 * 1024 * 1024;

function dataRoot(): string {
  if (process.env.MAXMA_DATA_DIR) return path.resolve(process.env.MAXMA_DATA_DIR);
  // bun-sidecar/src/kernel → bun-sidecar/src → bun-sidecar → repo root
  return path.resolve(import.meta.dir, "..", "..", "..");
}

export function agentAuditDir(): string {
  return path.join(dataRoot(), "api", "data");
}

export function agentAuditPath(): string {
  return path.join(agentAuditDir(), "agent_audit.jsonl");
}

export function agentSnapshotsDir(): string {
  return path.join(agentAuditDir(), "agent_snapshots");
}

export interface AgentAuditRecord {
  timestamp: string;
  epoch: number;
  type: "agent_tool";
  session_id: string;
  tool_call_id?: string;
  tool_name: string;
  decision: "start" | "end" | "error" | "denied";
  target?: string;
  detail?: string;
  input_summary?: string;
  duration_ms?: number;
  snapshot_id?: string;
  snapshot_reason?: string;
  error?: string;
}

export interface SnapshotMetadata {
  id: string;
  session_id: string;
  tool_call_id?: string;
  tool_name: string;
  path: string;
  existed: boolean;
  size: number;
  sha256?: string;
  created_at: number;
  truncated: boolean;
  content_base64?: string;
}

function isoNow(): { timestamp: string; epoch: number } {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const offsetMin = -now.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const tz = `${sign}${p(Math.floor(Math.abs(offsetMin) / 60))}${p(Math.abs(offsetMin) % 60)}`;
  return {
    timestamp:
      `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
      `T${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}${tz}`,
    epoch: Math.floor(now.getTime() / 1000),
  };
}

function redact(value: string): string {
  return value
    .replace(/((?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*)([^\s,;"']+)/gi, "$1[REDACTED]")
    .replace(/(--?(?:token|password|secret)\s+)([^\s,;"']+)/gi, "$1[REDACTED]")
    .slice(0, 800);
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "content" || key === "new_string" || key === "old_string" || key === "text") {
      safe[key] = typeof value === "string" ? `[${value.length} chars]` : "[omitted]";
    } else if (typeof value === "string") {
      safe[key] = redact(value);
    } else if (value !== undefined) {
      safe[key] = value;
    }
  }
  return redact(JSON.stringify(safe));
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function rotateIfNeeded(file: string, maxBytes: number): void {
  try {
    if (fs.statSync(file).size <= maxBytes) return;
    const rotated = `${file}.1`;
    try { fs.rmSync(rotated, { force: true }); } catch { /* best effort */ }
    fs.renameSync(file, rotated);
  } catch {
    // 文件不存在或不可读都无需处理。
  }
}

/** 追加一条审计；永不抛出（调用方是工具执行路径）。 */
export function appendAgentAudit(record: Omit<AgentAuditRecord, "timestamp" | "epoch" | "type">): AgentAuditRecord {
  const time = isoNow();
  const full: AgentAuditRecord = { ...record, ...time, type: "agent_tool" };
  try {
    ensureDir(agentAuditDir());
    rotateIfNeeded(agentAuditPath(), MAX_AUDIT_BYTES);
    fs.appendFileSync(agentAuditPath(), `${JSON.stringify(full)}\n`, "utf8");
  } catch (error) {
    console.warn(`[agent-audit] write failed: ${String(error)}`);
  }
  return full;
}

function extractWritePath(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const candidate = record.file_path ?? record.path;
  return typeof candidate === "string" && candidate.trim() ? candidate : null;
}

export function snapshotBeforeWrite(input: {
  sessionId: string;
  cwd: string;
  toolName: string;
  toolCallId?: string;
  args: unknown;
}): { snapshotId?: string; reason?: string; path?: string; existed?: boolean } {
  const rawPath = extractWritePath(input.args);
  if (!rawPath) return { reason: "工具没有可快照的文件路径" };
  const resolved = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(input.cwd, rawPath);
  try {
    ensureDir(agentSnapshotsDir());
    const sessionDir = path.join(agentSnapshotsDir(), input.sessionId.replace(/[^a-zA-Z0-9_-]/g, "_"));
    ensureDir(sessionDir);
    const id = `snap_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return { reason: "目标不是普通文件，未快照", path: resolved };
    }
    const size = stat.size;
    if (size > MAX_SNAPSHOT_BYTES) {
      return { reason: `文件超过 ${MAX_SNAPSHOT_BYTES} 字节，未快照`, path: resolved, existed: true };
    }
    const content = fs.readFileSync(resolved);
    const metadata: SnapshotMetadata = {
      id,
      session_id: input.sessionId,
      tool_call_id: input.toolCallId,
      tool_name: input.toolName,
      path: resolved,
      existed: true,
      size,
      sha256: crypto.createHash("sha256").update(content).digest("hex"),
      created_at: Date.now(),
      truncated: false,
      content_base64: content.toString("base64"),
    };
    fs.writeFileSync(path.join(sessionDir, `${id}.json`), JSON.stringify(metadata), "utf8");
    return { snapshotId: id, path: resolved, existed: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // 新文件：记录 existed=false，不写内容；恢复时删除目标。
      try {
        ensureDir(agentSnapshotsDir());
        const sessionDir = path.join(agentSnapshotsDir(), input.sessionId.replace(/[^a-zA-Z0-9_-]/g, "_"));
        ensureDir(sessionDir);
        const id = `snap_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
        const metadata: SnapshotMetadata = {
          id,
          session_id: input.sessionId,
          tool_call_id: input.toolCallId,
          tool_name: input.toolName,
          path: resolved,
          existed: false,
          size: 0,
          created_at: Date.now(),
          truncated: false,
        };
        fs.writeFileSync(path.join(sessionDir, `${id}.json`), JSON.stringify(metadata), "utf8");
        return { snapshotId: id, path: resolved, existed: false };
      } catch (inner) {
        return { reason: `快照失败：${String(inner)}`, path: resolved };
      }
    }
    return { reason: `快照失败：${String(error)}`, path: resolved };
  }
}

export function recordToolDenied(input: {
  sessionId: string;
  toolName: string;
  toolCallId?: string;
  args?: unknown;
  reason: string;
}): void {
  appendAgentAudit({
    session_id: input.sessionId,
    tool_call_id: input.toolCallId,
    tool_name: input.toolName,
    decision: "denied",
    detail: input.reason,
    input_summary: summarizeInput(input.args),
    error: input.reason,
  });
}

export function recordToolStart(input: {
  sessionId: string;
  cwd: string;
  toolName: string;
  toolCallId?: string;
  args: unknown;
}): void {
  const snapshot = snapshotBeforeWrite(input);
  appendAgentAudit({
    session_id: input.sessionId,
    tool_call_id: input.toolCallId,
    tool_name: input.toolName,
    decision: "start",
    target: snapshot.path,
    input_summary: summarizeInput(input.args),
    ...(snapshot.snapshotId ? { snapshot_id: snapshot.snapshotId } : {}),
    ...(snapshot.reason ? { snapshot_reason: snapshot.reason } : {}),
  });
}

export function recordToolEnd(input: {
  sessionId: string;
  toolName: string;
  toolCallId?: string;
  isError: boolean;
  durationMs?: number;
  errorText?: string;
}): void {
  appendAgentAudit({
    session_id: input.sessionId,
    tool_call_id: input.toolCallId,
    tool_name: input.toolName,
    decision: input.isError ? "error" : "end",
    detail: input.isError ? "工具执行失败" : "工具执行完成",
    duration_ms: input.durationMs,
    ...(input.errorText ? { error: redact(input.errorText) } : {}),
  });
}

export { summarizeInput };
