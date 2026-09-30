/**
 * routes/news.ts — 系统更新动态（api/routes/news.py 的 Bun 直译，阶段二 2.1）。
 *
 * 契约对齐：GET /api/news → { news: NewsEntry[] }，按 date 降序；
 * 脏数据容错（单条字段缺失/类型错误只跳过该条）；pr_number 空字符串视为 null。
 */

import { Hono } from "hono";
import * as fs from "node:fs";

import { getNewsYamlPath } from "../app-paths";

/** news.yaml 路径（与 Python NEWS_YAML_PATH 一致）。 */
export function newsYamlPath(): string {
  return getNewsYamlPath();
}

interface NewsEntry {
  id: string;
  en_title: string | null;
  title: string;
  description: string;
  type: string;
  date: string;
  tags: string[];
  version: string;
  pr_number: number | null;
}

/** 单条脏数据容错：字段校验失败返回 null（调用方跳过）。 */
function parseEntry(item: unknown): NewsEntry | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.title !== "string") return null;
  if (typeof raw.description !== "string" || typeof raw.type !== "string") return null;
  if (typeof raw.date !== "string") return null;
  // pr_number 容错：空字符串（''）视为 null（Python field_validator 同语义）
  let prNumber: number | null = null;
  if (typeof raw.pr_number === "number") prNumber = raw.pr_number;
  else if (typeof raw.pr_number === "string" && raw.pr_number.trim() !== "") {
    const n = Number(raw.pr_number);
    if (Number.isFinite(n)) prNumber = n;
  }
  return {
    id: raw.id,
    en_title: typeof raw.en_title === "string" ? raw.en_title : null,
    title: raw.title,
    description: raw.description,
    type: raw.type,
    date: raw.date,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [],
    version: typeof raw.version === "string" ? raw.version : "",
    pr_number: prNumber,
  };
}

export function loadNews(): NewsEntry[] {
  const file = newsYamlPath();
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = Bun.YAML.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.error("[news] News file has unexpected top-level type");
      return [];
    }
    const items = (parsed as Record<string, unknown>).news;
    if (!Array.isArray(items)) return [];
    const entries: NewsEntry[] = [];
    for (const item of items) {
      const entry = parseEntry(item);
      if (entry) entries.push(entry);
    }
    // 按日期降序（最新在前）
    entries.sort((a, b) => b.date.localeCompare(a.date));
    return entries;
  } catch (err) {
    console.error(`[news] Failed to read news file: ${file}`, err);
    return [];
  }
}

export function createNewsRoutes(): Hono {
  const app = new Hono();
  app.get("/api/news", (c) => c.json({ news: loadNews() }));
  return app;
}
