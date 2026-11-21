/**
 * routes/audit-log.ts — 审计日志（api/routes/audit_log.py 的 Bun 直译，2.2）。
 *
 * 数据：api/data/audit_log.json（JSON 数组，原子写）。Bun 单线程同步 I/O
 * 下无需 Python 版的锁链（LOCK-LEAK-001 问题不存在）。
 */

import { Hono } from "hono";
import type { Context } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";

import { getApiDataDir } from "../app-paths";
import { listWorkspaceRoots } from "../services/workspace-store";
import { listPathAllowlist } from "../services/path-allowlist";
import { PathPolicy } from "../../../bun-sidecar/src/kernel/path-policy";

function logPath(): string {
  return path.join(getApiDataDir(), "audit_log.json");
}

function agentLogPath(): string {
  return path.join(getApiDataDir(), "agent_audit.jsonl");
}

function snapshotsDir(): string {
  return path.join(getApiDataDir(), "agent_snapshots");
}

interface BunServerLike {
  requestIP?: (req: Request) => { address?: string } | null;
}

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

function requestIsLoopback(c: Context): boolean {
  const server = (c.env as { server?: BunServerLike } | undefined)?.server;
  const address = server?.requestIP?.(c.req.raw)?.address;
  return Boolean(address && LOOPBACK_ADDRESSES.has(address));
}

function loadAgentRecords(limit = 2000): AuditRecord[] {
  try {
    const file = agentLogPath();
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
    const records: AuditRecord[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (parsed && typeof parsed === "object") records.push(parsed as AuditRecord);
      } catch {
        // 单行损坏不拖垮整个审计页。
      }
    }
    return records;
  } catch {
    return [];
  }
}

type AuditRecord = Record<string, unknown>;

function loadRecords(): AuditRecord[] {
  try {
    const file = logPath();
    if (!fs.existsSync(file)) return [];
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return Array.isArray(data) ? (data as AuditRecord[]) : [];
  } catch {
    return [];
  }
}

function saveRecords(records: AuditRecord[]): void {
  const file = logPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

interface SnapshotMetadata {
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

function listSnapshots(): Array<Omit<SnapshotMetadata, "content_base64">> {
  const dir = snapshotsDir();
  if (!fs.existsSync(dir)) return [];
  const result: Array<Omit<SnapshotMetadata, "content_base64">> = [];
  for (const session of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!session.isDirectory()) continue;
    const sessionDir = path.join(dir, session.name);
    for (const file of fs.readdirSync(sessionDir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(sessionDir, file.name), "utf8")) as SnapshotMetadata;
        if (!parsed.id || typeof parsed.path !== "string") continue;
        const { content_base64: _content, ...meta } = parsed;
        result.push(meta);
      } catch {
        // 损坏快照不参与列表。
      }
    }
  }
  return result.sort((a, b) => b.created_at - a.created_at).slice(0, 100);
}

function findSnapshot(id: string): SnapshotMetadata | null {
  if (!/^snap_[A-Za-z0-9_]+$/.test(id)) return null;
  const dir = snapshotsDir();
  if (!fs.existsSync(dir)) return null;
  for (const session of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!session.isDirectory()) continue;
    const file = path.join(dir, session.name, `${id}.json`);
    if (!fs.existsSync(file)) continue;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as SnapshotMetadata;
    } catch {
      return null;
    }
  }
  return null;
}

function computeStats(records: AuditRecord[]): Record<string, unknown> {
  const byType = new Map<string, number>();
  const byStatus = new Map<string, number>();
  const targets = new Map<string, number>();
  for (const r of records) {
    const type = String(r.type ?? "unknown");
    const status = String(r.status ?? "unknown");
    const target = String(r.target ?? "unknown");
    byType.set(type, (byType.get(type) ?? 0) + 1);
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    targets.set(target, (targets.get(target) ?? 0) + 1);
  }
  return {
    total: records.length,
    by_type: Object.fromEntries(byType),
    by_status: Object.fromEntries(byStatus),
    top_targets: [...targets.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([target, count]) => ({ target, count })),
  };
}

export function createAuditLogRoutes(): Hono {
  const app = new Hono();

  app.use("/api/audit-log/snapshots*", async (c, next) => {
    if (!requestIsLoopback(c)) {
      return c.json({ error: { code: "LOOPBACK_ONLY", message: "快照恢复仅允许本机访问" } }, 403);
    }
    return await next();
  });

  app.get("/api/audit-log", (c) => {
    let limit = 50;
    const limitRaw = c.req.query("limit");
    if (limitRaw !== undefined) {
      const n = Number(limitRaw);
      if (Number.isFinite(n) && n >= 1 && n <= 1000) limit = Math.floor(n);
    }
    const eventType = c.req.query("event_type");
    const since = c.req.query("since");

    let records = [...loadRecords(), ...loadAgentRecords()];
    if (eventType) records = records.filter((r) => r.type === eventType);
    if (since) records = records.filter((r) => String(r.timestamp ?? "") >= since);

    records = records.sort((a, b) => String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? "")));
    return c.json({ records: records.slice(0, limit) });
  });

  app.get("/api/audit-log/stats", (c) => {
    return c.json({ stats: computeStats([...loadRecords(), ...loadAgentRecords()]) });
  });

  app.post("/api/audit-log/clear", (c) => {
    const records = loadRecords();
    const agentRecords = loadAgentRecords();
    const deleted = records.length + agentRecords.length;
    saveRecords([]);
    try { fs.rmSync(agentLogPath(), { force: true }); } catch { /* best effort */ }
    return c.json({ status: "ok", deleted });
  });

  app.get("/api/audit-log/snapshots", (c) => {
    return c.json({ snapshots: listSnapshots() });
  });

  app.post("/api/audit-log/snapshots/:id/restore", (c) => {
    const snapshot = findSnapshot(c.req.param("id"));
    if (!snapshot) return c.json({ error: { code: "SNAPSHOT_NOT_FOUND", message: "快照不存在" } }, 404);

    const roots = [
      ...listWorkspaceRoots().map((root) => root.realpath),
      ...listPathAllowlist().map((entry) => entry.realpath),
    ];
    if (roots.length === 0) {
      return c.json({ error: { code: "PATH_OUTSIDE_ROOT", message: "没有可用的授权工作区" } }, 403);
    }
    const policy = new PathPolicy({ roots });
    const decision = policy.check(snapshot.path, "write");
    if (!decision.allowed) {
      return c.json(
        { error: { code: decision.code ?? "PATH_OUTSIDE_ROOT", message: decision.reason ?? "快照目标不在授权工作区" } },
        403,
      );
    }

    try {
      fs.mkdirSync(path.dirname(snapshot.path), { recursive: true });
      if (!snapshot.existed) {
        const stat = fs.existsSync(snapshot.path) ? fs.lstatSync(snapshot.path) : null;
        if (stat?.isDirectory()) {
          return c.json({ error: { code: "RESTORE_BLOCKED", message: "目标已变成目录，拒绝删除" } }, 409);
        }
        fs.rmSync(snapshot.path, { force: true });
        return c.json({ restored: true, path: snapshot.path, existed: false });
      }
      if (typeof snapshot.content_base64 !== "string") {
        return c.json({ error: { code: "SNAPSHOT_INCOMPLETE", message: "快照缺少内容" } }, 409);
      }
      const content = Buffer.from(snapshot.content_base64, "base64");
      const tmp = `${snapshot.path}.maxma-restore-${process.pid}-${Date.now()}`;
      fs.writeFileSync(tmp, content);
      fs.renameSync(tmp, snapshot.path);
      return c.json({ restored: true, path: snapshot.path, existed: true, size: content.length });
    } catch (error) {
      return c.json(
        { error: { code: "RESTORE_FAILED", message: error instanceof Error ? error.message : String(error) } },
        500,
      );
    }
  });

  app.post("/api/audit-log/append", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const now = new Date();
    // 对齐 Python time.strftime("%Y-%m-%dT%H:%M:%S%z")：本地时间 + 数字时区偏移
    const p = (n: number) => String(n).padStart(2, "0");
    const offsetMin = -now.getTimezoneOffset();
    const sign = offsetMin >= 0 ? "+" : "-";
    const tz = `${sign}${p(Math.floor(Math.abs(offsetMin) / 60))}${p(Math.abs(offsetMin) % 60)}`;
    const timestamp =
      `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
      `T${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}${tz}`;
    const record: AuditRecord = {
      timestamp,
      epoch: Math.floor(now.getTime() / 1000),
      type: typeof body.type === "string" ? body.type : "info",
      target: typeof body.target === "string" ? body.target : "system",
      detail: typeof body.detail === "string" ? body.detail : "",
      data_size: typeof body.data_size === "number" ? body.data_size : 0,
      status: typeof body.status === "string" ? body.status : "ok",
    };
    if (body.extra && typeof body.extra === "object") record.extra = body.extra;
    const records = loadRecords();
    records.push(record);
    saveRecords(records);
    return c.json({ ok: true, record });
  });

  return app;
}
