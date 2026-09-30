/**
 * routes/stickers.ts — 表情包文件服务（api/routes/stickers.py 的 Bun 直译）。
 *
 * 安全校验原样保留：category 白名单正则、filename 仅 [\w-]+.webp、
 * resolve 前缀校验；custom 分类优先从 DATA_DIR 查找。
 */

import { Hono } from "hono";
import * as fs from "node:fs";
import * as path from "node:path";

import { bundleDir, dataDir } from "../app-paths";

export function stickersDir(): string {
  return path.join(bundleDir(), "config", "stickers");
}
export function customStickersDir(): string {
  return path.join(dataDir(), "config", "stickers", "custom");
}

const CATEGORY_RE = /^[\w\u4e00-\u9fff-]+$/;
const FILENAME_RE = /^[\w-]+\.webp$/;

const WEBP_MIME = "image/webp";
const CACHE_HEADERS = { "cache-control": "max-age=86400, immutable" };

export function createStickerFileRoutes(): Hono {
  const app = new Hono();

  app.get("/api/stickers/random/:category", (c) => {
    const category = c.req.param("category");
    if (!CATEGORY_RE.test(category)) return c.json({ detail: "非法分类名" }, 400);
    const catDir = path.join(stickersDir(), category);
    if (!fs.existsSync(catDir) || !fs.statSync(catDir).isDirectory()) {
      return c.json({ detail: "该分类无表情" }, 404);
    }
    const stickers = fs.readdirSync(catDir).filter((f) => f.endsWith(".webp")).sort();
    if (stickers.length === 0) return c.json({ detail: "该分类无表情" }, 404);
    const pick = stickers[Math.floor(Math.random() * stickers.length)]!;
    return c.json({ path: `${category}/${pick}`, category });
  });

  app.get("/api/stickers/:category/:filename", (c) => {
    const category = c.req.param("category");
    const filename = c.req.param("filename");
    if (!CATEGORY_RE.test(category)) return c.json({ detail: "非法分类名" }, 400);
    if (!FILENAME_RE.test(filename)) return c.json({ detail: "非法文件名" }, 400);

    let filePath: string;
    let base: string;
    if (category === "custom") {
      filePath = path.join(customStickersDir(), filename);
      base = customStickersDir();
    } else {
      filePath = path.join(stickersDir(), category, filename);
      base = stickersDir();
    }
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(base) + path.sep)) {
      return c.json({ detail: "路径非法" }, 403);
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return c.json({ detail: "贴纸不存在" }, 404);
    }
    return new Response(Bun.file(resolved), {
      headers: { "content-type": WEBP_MIME, ...CACHE_HEADERS },
    });
  });

  app.get("/api/stickers", (c) => {
    const categories: Record<string, number> = {};
    const builtin = stickersDir();
    if (fs.existsSync(builtin) && fs.statSync(builtin).isDirectory()) {
      for (const entry of fs.readdirSync(builtin, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory()) continue;
        const count = fs
          .readdirSync(path.join(builtin, entry.name))
          .filter((f) => f.endsWith(".webp")).length;
        if (count > 0) categories[entry.name] = count;
      }
    }
    const custom = customStickersDir();
    if (fs.existsSync(custom) && fs.statSync(custom).isDirectory()) {
      const count = fs.readdirSync(custom).filter((f) => f.endsWith(".webp")).length;
      if (count > 0) categories.custom = count;
    }
    return c.json({ categories });
  });

  return app;
}
