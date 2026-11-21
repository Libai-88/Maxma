/**
 * routes/memory.ts — 记忆页 API（三层：persona / project / session）。
 *
 * 原有 persona 读写语义保持不变（同一文件、同一投影）；新增：
 *   - `?scope=persona|project|session|all` 分层读取（默认 all，UI 用 tab 切换）
 *   - `POST /api/memory` 手工写入任意层（project/session 必须带 key）
 *   - `GET /api/memory/export` / `POST /api/memory/import` 打包迁移
 *   - `GET /api/memory/conflicts` 列出裁决记录（合并/冲突处理留痕）
 */

import { Hono } from "hono";

import {
  addMemory,
  appendConflictDecision,
  conflictsLogPath,
  exportMemoryBundle,
  importMemoryBundle,
  listMemories,
  loadYamlDocument,
  memoryStats as layerStats,
  personaMemoryPath,
  type MemoryScope,
} from "../services/memory-store";
import * as fs from "node:fs";
import * as path from "node:path";

const PROJECTION_OPERATIONS_KEY = "_maxma_ltm_projection_operations";

export function memoryFilePath(): string {
  return personaMemoryPath();
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

function parseScope(value: string | undefined): MemoryScope | "all" {
  return value === "persona" || value === "project" || value === "session" ? value : "all";
}

/** 记忆统计（total/categories）——capabilities 聚合复用。
 *  不再给 `avg_confidence`：写入方从不设置 confidence，恒为 1.0 的"平均置信度"
 *  是凭空造出的可信度信号。 */
export function memoryStats(): { total: number; categories: Record<string, number> } {
  const stats = layerStats("all");
  return { total: stats.total, categories: stats.categories };
}

export function memoryStatsSummary(): { total: number; categories: Record<string, number> } {
  return memoryStats();
}

export function createMemoryRoutes(): Hono {
  const app = new Hono();

  app.get("/api/memory", (c) => {
    const q = c.req.query("q");
    const category = c.req.query("category");
    const scope = parseScope(c.req.query("scope"));

    let facts = listMemories(scope);
    if (q) {
      const ql = q.toLowerCase();
      facts = facts.filter((f) => f.content.toLowerCase().includes(ql));
    }
    if (category && category !== "all") {
      facts = facts.filter((f) => f.category === category);
    }
    return c.json(facts);
  });

  app.get("/api/memory/stats", (c) => {
    if (c.req.query("scope")) return c.json(layerStats(parseScope(c.req.query("scope"))));
    return c.json(memoryStatsSummary());
  });

  app.post("/api/memory", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      scope?: unknown; content?: unknown; category?: unknown; key?: unknown;
    };
    try {
      const scope = body.scope === "project" || body.scope === "session" ? body.scope : "persona";
      const fact = addMemory({
        scope,
        content: String(body.content ?? ""),
        category: typeof body.category === "string" ? body.category : undefined,
        key: typeof body.key === "string" ? body.key : undefined,
      });
      return c.json(fact, 201);
    } catch (error) {
      return c.json({ detail: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/memory/export", (c) => {
    return c.json(exportMemoryBundle());
  });

  app.post("/api/memory/import", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { bundle?: unknown; mode?: unknown } | null;
    if (!body || typeof body !== "object") return c.json({ detail: "请求体必须是 JSON" }, 400);
    try {
      const mode = body.mode === "replace" ? "replace" : "merge";
      const result = importMemoryBundle(body.bundle, mode);
      appendConflictDecision({ action: "import", mode, result });
      return c.json({ status: "imported", ...result });
    } catch (error) {
      return c.json({ detail: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/memory/conflicts", (c) => {
    const file = conflictsLogPath();
    const records: unknown[] = [];
    try {
      const raw = fs.readFileSync(file, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try { records.push(JSON.parse(line)) } catch { /* 跳过坏行 */ }
      }
    } catch {
      // 没有裁决记录
    }
    return c.json(records.slice(-100));
  });

  app.post("/api/memory/conflicts", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { ids?: unknown; kept?: unknown; reason?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : [];
    if (ids.length < 2) return c.json({ detail: "至少需要 2 个记忆 id" }, 400);
    const kept = typeof body.kept === "string" && body.kept.trim() ? body.kept.trim() : ids[0]!;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    appendConflictDecision({ action: "resolve", ids, kept, reason });
    return c.json({ status: "recorded", ids, kept, reason });
  });

  app.delete("/api/memory/:memoryId", (c) => {
    const memoryId = c.req.param("memoryId");
    const file = memoryFilePath();
    const document = loadYamlDocument(file);
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
    const file = memoryFilePath();
    const document = loadYamlDocument(file);
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
