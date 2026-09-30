/**
 * routes/sticker-favorites.ts — 表情收藏管理（api/routes/sticker_favorites.py
 * 的 Bun 直译，阶段二 2.2）。
 *
 * 数据：API_DATA_DIR/sticker_favorites.yaml 与 sticker_recent.yaml
 * （STICKER-ATOMIC-001：原子写）。Bun 单线程同步 I/O 下锁链不必要。
 * recommendations 的情感检测已随 tools/ 移除停用（inline stub 同语义）。
 */

import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";

import { bundleDir, dataDir } from "../app-paths";

const CATEGORY_RE = /^[\w\u4e00-\u9fff-]+$/;
const FILENAME_RE = /^[\w-]+\.webp$/;

function favoritesPath(): string {
  return path.join(dataDir(), "api", "data", "sticker_favorites.yaml");
}
function recentPath(): string {
  return path.join(dataDir(), "api", "data", "sticker_recent.yaml");
}
function stickersDir(): string {
  return path.join(bundleDir(), "config", "stickers");
}
function customStickersDir(): string {
  return path.join(dataDir(), "config", "stickers", "custom");
}

function validateStickerRef(category: string, filename: string): string | null {
  if (!CATEGORY_RE.test(category)) return "非法分类名";
  if (!FILENAME_RE.test(filename)) return "非法文件名";
  return null;
}

function loadYamlSafe(filePath: string, defaults: Record<string, unknown>): Record<string, unknown> {
  try {
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      writeYaml(filePath, defaults);
      return defaults;
    }
    const parsed = Bun.YAML.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown> | null;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function writeYaml(filePath: string, data: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, Bun.YAML.stringify(data), "utf8");
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

function stickerExists(category: string, filename: string): boolean {
  if (validateStickerRef(category, filename)) return false;
  if (category === "custom") {
    return fs.existsSync(path.join(customStickersDir(), filename));
  }
  return fs.existsSync(path.join(stickersDir(), category, filename));
}

function selectSticker(category: string): string | null {
  const catDir = path.join(stickersDir(), category);
  if (!fs.existsSync(catDir) || !fs.statSync(catDir).isDirectory()) return null;
  for (const f of fs.readdirSync(catDir)) {
    if (f.endsWith(".webp")) return `${category}/${f}`;
  }
  return null;
}

function timePeriod(): string {
  const hour = new Date().getHours();
  if (hour >= 0 && hour < 6) return "late_night";
  if (hour < 12) return "morning";
  if (hour < 18) return "work";
  return "evening";
}

export function createStickerFavoritesRoutes(): Hono {
  const app = new Hono();

  app.get("/api/stickers/favorites", (c) => {
    const data = loadYamlSafe(favoritesPath(), { favorites: [] });
    const favorites = Array.isArray(data.favorites) ? data.favorites : [];
    const result = favorites.map((item) => {
      const copy = { ...(item as Record<string, unknown>) } as Record<string, unknown>;
      copy.path = `${copy.category ?? ""}/${copy.filename ?? ""}`;
      copy.usage_count = 0;
      return copy;
    });
    return c.json({ favorites: result });
  });

  app.post("/api/stickers/favorites", async (c) => {
    const req = (await c.req.json().catch(() => ({}))) as { category?: string; filename?: string };
    const category = req.category ?? "";
    const filename = req.filename ?? "";
    const invalid = validateStickerRef(category, filename);
    if (invalid) return c.json({ detail: invalid }, 400);
    if (!stickerExists(category, filename)) return c.json({ detail: "表情不存在" }, 404);

    const data = loadYamlSafe(favoritesPath(), { favorites: [] });
    const favorites: Record<string, unknown>[] = Array.isArray(data.favorites) ? (data.favorites as Record<string, unknown>[]) : [];
    if (favorites.some((f) => f.filename === filename && f.category === category)) {
      return c.json({ success: false, message: "已在收藏中" });
    }
    favorites.push({ category, filename, added_at: new Date().toISOString() });
    writeYaml(favoritesPath(), { favorites });
    return c.json({ success: true, message: "已收藏" });
  });

  app.delete("/api/stickers/favorites", (c) => {
    const filename = c.req.query("filename") ?? "";
    const category = c.req.query("category") ?? "";
    const data = loadYamlSafe(favoritesPath(), { favorites: [] });
    const favorites: Record<string, unknown>[] = Array.isArray(data.favorites) ? (data.favorites as Record<string, unknown>[]) : [];
    const next = favorites.filter(
      (f) => !(f.filename === filename && f.category === category),
    );
    if (next.length === favorites.length) {
      return c.json({ success: false, message: "未找到收藏" });
    }
    writeYaml(favoritesPath(), { favorites: next });
    return c.json({ success: true, message: "已取消收藏" });
  });

  app.post("/api/stickers/usage", async (c) => {
    const req = (await c.req.json().catch(() => ({}))) as { category?: string; filename?: string };
    if (!stickerExists(req.category ?? "", req.filename ?? "")) {
      return c.json({ detail: "表情不存在" }, 404);
    }
    return c.json({ success: true, message: "已记录使用" });
  });

  app.post("/api/stickers/skip", async (c) => {
    const req = (await c.req.json().catch(() => ({}))) as { category?: string; filename?: string };
    if (!stickerExists(req.category ?? "", req.filename ?? "")) {
      return c.json({ detail: "表情不存在" }, 404);
    }
    return c.json({ success: true, message: "已减少推荐" });
  });

  app.get("/api/stickers/recent", (c) => {
    const limit = Number(c.req.query("limit") ?? 50) || 50;
    const data = loadYamlSafe(recentPath(), { recent: [] });
    const recent = Array.isArray(data.recent) ? data.recent : [];
    const result: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    for (const item of [...recent].reverse()) {
      const copy = { ...(item as Record<string, unknown>) } as Record<string, unknown>;
      copy.path = `${copy.category ?? ""}/${copy.filename ?? ""}`;
      if (seen.has(String(copy.path))) continue;
      seen.add(String(copy.path));
      result.push(copy);
    }
    return c.json({ recent: result.slice(0, limit) });
  });

  app.get("/api/stickers/recommendations", (c) => {
    let limit = 4;
    const limitRaw = c.req.query("limit");
    if (limitRaw !== undefined) {
      const n = Number(limitRaw);
      if (Number.isFinite(n) && n >= 1 && n <= 12) limit = Math.floor(n);
    }
    // 情感检测已停用（与 Python inline stub 同语义），按时间段推荐
    const period = timePeriod();
    const preferred: Record<string, string[]> = {
      late_night: ["爱心", "委屈", "日常"],
      morning: ["日常", "开心"],
      work: ["无语", "开心", "日常"],
      evening: ["开心", "爱心", "日常"],
    };
    const categories = [...(preferred[period] ?? []), "开心", "爱心", "日常", "无语"];
    const deduped = [...new Set(categories)];

    const seen = new Set<string>();
    const recommendations: Array<{ category: string; filename: string; path: string }> = [];
    for (const category of deduped) {
      const stickerPath = selectSticker(category);
      if (!stickerPath || seen.has(stickerPath)) continue;
      seen.add(stickerPath);
      const filename = stickerPath.split("/")[1]!;
      recommendations.push({ category, filename, path: stickerPath });
      if (recommendations.length >= limit) break;
    }
    return c.json({ recommendations: recommendations.slice(0, limit) });
  });

  app.get("/api/stickers/index", (c) => {
    const index: Record<string, unknown> = {};
    const builtin = stickersDir();
    if (fs.existsSync(builtin) && fs.statSync(builtin).isDirectory()) {
      for (const entry of fs.readdirSync(builtin, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        for (const f of fs.readdirSync(path.join(builtin, entry.name))) {
          if (f.endsWith(".webp")) {
            index[`${entry.name}/${f}`] = { category: entry.name, filename: f, path: `${entry.name}/${f}` };
          }
        }
      }
    }
    const custom = customStickersDir();
    if (fs.existsSync(custom) && fs.statSync(custom).isDirectory()) {
      for (const f of fs.readdirSync(custom)) {
        if (f.endsWith(".webp")) {
          index[`custom/${f}`] = { category: "custom", filename: f, path: `custom/${f}` };
        }
      }
    }
    return c.json({ index });
  });

  return app;
}
