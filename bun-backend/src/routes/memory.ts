/**
 * routes/memory.ts — 记忆页 API（api/routes/memory.py 的 Bun 直译，阶段二 2.2）。
 *
 * 数据：PERSONAS_DATA_DIR/memory.yaml（与 sidecar remember_memory/search_memories
 * 工具同文件）。投影契约：{id, content, category, confidence, updatedAt}，
 * 过期条目剔除、`_` 前缀键跳过。
 * 并发：Bun 单线程事件循环 + 同步文件 I/O 天然串行（Python 版的进程内锁 +
 * portalocker 双重保障在 JS 侧无必要）；原子写保留（对齐 _write_document）。
 */

import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";

import { getPersonasDataDir } from "../app-paths";

const PROJECTION_OPERATIONS_KEY = "_maxma_ltm_projection_operations";

export function memoryFilePath(): string {
  return path.join(getPersonasDataDir(), "memory.yaml");
}

function loadDocument(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = Bun.YAML.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    if (parsed === null || parsed === undefined) return {};
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      console.warn(`[memory] invalid top-level document in ${filePath}`);
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    console.warn(`[memory] failed to read ${filePath}: ${String(err)}`);
    return null;
  }
}

/** 日期解析容错：ISO / "YYYY-MM-DD HH:MM:SS" / "YYYY-MM-DD"。 */
function parseDatetime(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim().replace("Z", "+00:00");
  const iso = new Date(normalized);
  if (!Number.isNaN(iso.getTime())) return iso;
  for (const fmt of ["YYYY-MM-DD HH:MM:SS", "YYYY-MM-DD"]) {
    if (fmt === "YYYY-MM-DD" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
      return new Date(`${value.trim()}T00:00:00`);
    }
    if (fmt === "YYYY-MM-DD HH:MM:SS" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value.trim())) {
      return new Date(value.trim().replace(" ", "T"));
    }
  }
  return null;
}

function isExpired(value: unknown): boolean {
  const parsed = parseDatetime(value);
  if (parsed === null) return false;
  return Date.now() >= parsed.getTime();
}

function displayTime(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return "";
  return String(value);
}

function confidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1.0;
  return Math.max(0, Math.min(1, value));
}

interface Fact {
  id: string;
  content: string;
  category: string;
  confidence: number;
  updatedAt: string;
}

function projectFacts(document: Record<string, unknown>): Fact[] {
  const facts: Fact[] = [];
  for (const [rawId, rawItem] of Object.entries(document)) {
    const itemId = String(rawId);
    if (itemId.startsWith("_") || rawItem === null || typeof rawItem !== "object") continue;
    const item = rawItem as Record<string, unknown>;

    if (isExpired(item.expires_at)) continue;
    const content = item.description ?? item.content;
    if (typeof content !== "string" || !content.trim()) continue;

    const category = item.theme ?? item.category ?? "other";
    facts.push({
      id: itemId,
      content,
      category: String(category || "other"),
      confidence: confidence(item.confidence),
      updatedAt: displayTime(item.latest_update_time ?? item.updatedAt),
    });
  }
  return facts;
}

function writeDocument(filePath: string, document: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, Bun.YAML.stringify(document), "utf8");
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // best-effort
    }
    throw err;
  }
}

export function createMemoryRoutes(): Hono {
  const app = new Hono();
  const filePath = () => memoryFilePath();

  app.get("/api/memory", (c) => {
    const q = c.req.query("q");
    const category = c.req.query("category");
    const minConfRaw = c.req.query("min_confidence");
    const minConfidence = minConfRaw !== undefined && minConfRaw !== "" ? Number(minConfRaw) : null;

    const document = loadDocument(filePath());
    if (document === null) return c.json([]);
    let facts = projectFacts(document);
    if (q) {
      const ql = q.toLowerCase();
      facts = facts.filter((f) => f.content.toLowerCase().includes(ql));
    }
    if (category && category !== "all") {
      facts = facts.filter((f) => f.category === category);
    }
    if (minConfidence !== null && Number.isFinite(minConfidence)) {
      facts = facts.filter((f) => f.confidence >= minConfidence);
    }
    return c.json(facts);
  });

  app.get("/api/memory/stats", (c) => {
    const document = loadDocument(filePath());
    if (document === null) return c.json({ total: 0, categories: {}, avg_confidence: 0 });
    const facts = projectFacts(document);
    const total = facts.length;
    const categories: Record<string, number> = {};
    let confSum = 0;
    for (const f of facts) {
      categories[f.category] = (categories[f.category] ?? 0) + 1;
      confSum += f.confidence;
    }
    return c.json({
      total,
      categories,
      avg_confidence: total > 0 ? Math.round((confSum / total) * 100) / 100 : 0,
    });
  });

  app.delete("/api/memory/:memoryId", (c) => {
    const memoryId = c.req.param("memoryId");
    const file = filePath();
    const document = loadDocument(file);
    if (document === null) return c.json({ detail: "记忆存储不可读" }, 503);

    const matchingKey = Object.keys(document).find(
      (key) => key === memoryId && key !== PROJECTION_OPERATIONS_KEY,
    );
    if (matchingKey === undefined) {
      return c.json({ detail: `未找到 ID 为 ${memoryId} 的记忆` }, 404);
    }
    delete document[matchingKey];
    writeDocument(file, document);
    return c.json({ status: "deleted", id: memoryId });
  });

  app.put("/api/memory/:memoryId", async (c) => {
    const memoryId = c.req.param("memoryId");
    const body = (await c.req.json().catch(() => ({}))) as { content?: string; category?: string };
    const file = filePath();
    const document = loadDocument(file);
    if (document === null) return c.json({ detail: "记忆存储不可读" }, 503);

    const matchingKey = Object.keys(document).find(
      (key) => key === memoryId && key !== PROJECTION_OPERATIONS_KEY,
    );
    if (matchingKey === undefined) {
      return c.json({ detail: `未找到 ID 为 ${memoryId} 的记忆` }, 404);
    }
    const entry = document[matchingKey];
    if (entry === null || typeof entry !== "object") {
      return c.json({ detail: "记忆条目格式异常" }, 400);
    }
    const mutable = entry as Record<string, unknown>;
    if (body.content !== undefined && body.content !== null) mutable.description = body.content;
    if (body.category !== undefined && body.category !== null) mutable.theme = body.category;
    document[matchingKey] = mutable;
    writeDocument(file, document);
    return c.json({ status: "updated", id: memoryId });
  });

  return app;
}
