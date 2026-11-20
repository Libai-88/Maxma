/**
 * stickers/legacy.ts — 旧表情协议的只读投影。
 *
 * 这些接口早于 dsh-meme pack 模型（分类目录、YAML 收藏/最近、随机推荐）。
 * 与主存储解耦，避免 service.ts 继续膨胀；路由仍按原路径返回同一形状。
 */
import * as fs from "node:fs";

import { BUILTIN_PACK_ID, LEGACY_CUSTOM_PACK_ID, legacyFavoritesPath, legacyRecentPath } from "./paths";
import { getStore, initStickerSystem, packUrl, recentItems } from "./service";

export function legacyIndex(): Record<string, unknown> {
  initStickerSystem();
  const out: Record<string, unknown> = {};
  for (const id of [BUILTIN_PACK_ID, LEGACY_CUSTOM_PACK_ID]) {
    const store = getStore(id);
    if (!store) continue;
    for (const row of store.rows) {
      const category = row.path.startsWith("custom/") ? "custom" : row.path.split("/")[0] || "custom";
      out[row.path] = {
        category,
        filename: row.file_name,
        path: row.path,
      };
    }
  }
  return out;
}

export function legacyCategories(): Record<string, number> {
  initStickerSystem();
  const categories: Record<string, number> = {};
  const builtin = getStore(BUILTIN_PACK_ID);
  if (builtin) {
    for (const row of builtin.rows) {
      const category = row.path.split("/")[0] || "";
      if (!category || category === "custom") continue;
      categories[category] = (categories[category] || 0) + 1;
    }
  }
  const legacy = getStore(LEGACY_CUSTOM_PACK_ID);
  if (legacy?.rows.length) categories.custom = legacy.rows.length;
  return categories;
}

export function randomByCategory(category: string): { path: string; category: string; url: string } | null {
  initStickerSystem();
  const store = getStore(BUILTIN_PACK_ID);
  if (!store) return null;
  const rows = store.rows.filter((r) => r.path.startsWith(`${category}/`));
  if (rows.length === 0) return null;
  const pick = rows[Math.floor(Math.random() * rows.length)]!;
  return { path: pick.path, category, url: packUrl(BUILTIN_PACK_ID, pick.path) };
}

export function legacyFavorites(): Array<Record<string, unknown>> {
  try {
    if (!fs.existsSync(legacyFavoritesPath())) return [];
    const parsed = Bun.YAML.parse(fs.readFileSync(legacyFavoritesPath(), "utf8")) as {
      favorites?: Array<Record<string, unknown>>;
    } | null;
    const list = Array.isArray(parsed?.favorites) ? parsed.favorites : [];
    return list.map((item) => ({
      ...item,
      path: `${item.category ?? ""}/${item.filename ?? ""}`,
      usage_count: 0,
    }));
  } catch {
    return [];
  }
}

export function legacyRecent(): Array<Record<string, unknown>> {
  try {
    if (!fs.existsSync(legacyRecentPath())) return recentItems();
    const parsed = Bun.YAML.parse(fs.readFileSync(legacyRecentPath(), "utf8")) as {
      recent?: Array<Record<string, unknown>>;
    } | null;
    return Array.isArray(parsed?.recent) ? parsed.recent : [];
  } catch {
    return [];
  }
}

export function recommendations(limit = 4): Array<{ category: string; filename: string; path: string; url: string }> {
  initStickerSystem();
  const store = getStore(BUILTIN_PACK_ID);
  if (!store) return [];
  const preferred = ["happy", "daily", "sad", "confused"];
  const out: Array<{ category: string; filename: string; path: string; url: string }> = [];
  for (const mood of preferred) {
    const rows = store.rows.filter((r) => r.tag === mood).slice(0, 1);
    for (const row of rows) {
      const category = row.path.split("/")[0] || "daily";
      out.push({
        category,
        filename: row.file_name,
        path: row.path,
        url: packUrl(BUILTIN_PACK_ID, row.path),
      });
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, Math.max(1, Math.min(12, limit)));
}
