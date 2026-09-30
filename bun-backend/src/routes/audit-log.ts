/**
 * routes/audit-log.ts — 审计日志（api/routes/audit_log.py 的 Bun 直译，2.2）。
 *
 * 数据：api/data/audit_log.json（JSON 数组，原子写）。Bun 单线程同步 I/O
 * 下无需 Python 版的锁链（LOCK-LEAK-001 问题不存在）。
 */

import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";

import { getApiDataDir } from "../app-paths";

function logPath(): string {
  return path.join(getApiDataDir(), "audit_log.json");
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

  app.get("/api/audit-log", (c) => {
    let limit = 50;
    const limitRaw = c.req.query("limit");
    if (limitRaw !== undefined) {
      const n = Number(limitRaw);
      if (Number.isFinite(n) && n >= 1 && n <= 1000) limit = Math.floor(n);
    }
    const eventType = c.req.query("event_type");
    const since = c.req.query("since");

    let records = loadRecords();
    if (eventType) records = records.filter((r) => r.type === eventType);
    if (since) records = records.filter((r) => String(r.timestamp ?? "") >= since);

    records = records.sort((a, b) => String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? "")));
    return c.json({ records: records.slice(0, limit) });
  });

  app.get("/api/audit-log/stats", (c) => {
    return c.json({ stats: computeStats(loadRecords()) });
  });

  app.post("/api/audit-log/clear", (c) => {
    const records = loadRecords();
    const deleted = records.length;
    saveRecords([]);
    return c.json({ status: "ok", deleted });
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
