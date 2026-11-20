/**
 * routes/stickers.ts — Maxma × dsh-meme 表情路由。
 *
 * 新接口：/index、/file/:packId/*、/packs、/settings、/upload、/memes/*
 * 兼容接口：/、/random/:category、/:category/:filename、/legacy/index、
 *           /favorites、/recent、/recommendations、/custom/*
 */
import { Hono } from "hono";
import type { Context } from "hono";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { dataDir } from "../app-paths";
import {
  activePackId,
  addRecent,
  deleteMeme,
  getPack,
  getStore,
  indexPayload,
  initStickerSystem,
  isSafeRelPath,
  legacyResolve,
  listPacks,
  loadSettings,
  migrationStatus,
  recentItems,
  resolveMemeFile,
  saveSettings,
  scanPack,
  setActivePack,
  setPackEnabled,
  stickerInitError,
  updateMeme,
  uploadSticker,
} from "../stickers/service";
import {
  legacyCategories,
  legacyFavorites,
  legacyIndex,
  legacyRecent,
  randomByCategory,
  recommendations,
} from "../stickers/legacy";
import {
  deleteRemotePack,
  exportPack,
  fetchMarketCatalog,
  installArchiveBuffer,
  installRemotePack,
} from "../stickers/market";
import {
  LEGACY_CUSTOM_PACK_ID,
  USER_PACK_ID,
  isSafePackId,
  legacyFavoritesPath,
} from "../stickers/paths";

const CATEGORY_RE = /^[\w\u4e00-\u9fff-]+$/;
const FILENAME_RE = /^[\w.-]+\.(webp|png|jpg|jpeg|gif)$/i;

const MIME: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
};

function mimeOf(file: string): string {
  return MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
}

function imageResponse(file: string, reqHeaders: Headers): Response {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return new Response("Not Found", { status: 404 });
  }
  const etag = `W/"${Math.round(stat.mtimeMs)}-${stat.size}"`;
  if (reqHeaders.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }
  return new Response(Bun.file(file), {
    headers: {
      "content-type": mimeOf(file),
      "cache-control": "public, max-age=86400",
      etag,
      "content-length": String(stat.size),
    },
  });
}

function writeYamlAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, Bun.YAML.stringify(value), "utf8");
    fs.rmSync(file, { force: true });
    fs.renameSync(tmp, file);
  } finally {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best-effort */
    }
  }
}

function validateLegacyRef(category: string, filename: string): string | null {
  if (!CATEGORY_RE.test(category)) return "非法分类名";
  if (!FILENAME_RE.test(filename)) return "非法文件名";
  return null;
}

function favoriteRefOf(body: Record<string, unknown>): { category: string; filename: string } {
  const p = typeof body.path === "string" ? body.path : "";
  if (p) {
    const parts = p.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return { category: parts[parts.length - 2]!, filename: parts[parts.length - 1]! };
    }
  }
  return {
    category: typeof body.category === "string" ? body.category : "",
    filename: typeof body.filename === "string" ? body.filename : "",
  };
}

export function createStickerRoutes(): Hono {
  const app = new Hono();

  // 惰性初始化：只有真正访问 /api/stickers/* 时才建库/迁移。
  // 不能在 createStickerRoutes() 里同步 init —— 所有路由测试都会创建 Hono app，
  // 提前打开 SQLite 会让 Windows 临时目录清理 EBUSY，污染无关测试。
  app.use("/api/stickers/*", async (_c, next) => {
    initStickerSystem();
    await next();
  });

  // ── 新接口 ──────────────────────────────────────────────────────────────

  app.get("/api/stickers/file/:packId/*", (c) => {
    const packId = c.req.param("packId");
    if (!isSafePackId(packId)) return c.json({ detail: "非法图库 id" }, 400);
    // Hono 的通配路由不会把 `*` 放在 c.req.param() 里；且 c.req.param("*") 是
    // undefined。这里从已经解码的 URL path 中截取相对路径，中文目录才能命中。
    const prefix = `/api/stickers/file/${packId}/`;
    const rel = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : "";
    if (!isSafeRelPath(rel)) return c.json({ detail: "路径非法" }, 400);
    const file = resolveMemeFile(packId, rel);
    if (!file) return c.json({ detail: "表情不存在" }, 404);
    return imageResponse(file, c.req.raw.headers);
  });

  app.get("/api/stickers/index", (c) => {
    if (stickerInitError()) return c.json({ detail: stickerInitError() }, 500);
    const packId = c.req.query("packId") || "all";
    if (packId !== "all" && !isSafePackId(packId)) {
      return c.json({ detail: "非法图库 id" }, 400);
    }
    const limit = Number(c.req.query("limit") || 2000);
    return c.json(
      indexPayload({
        packId,
        tag: c.req.query("tag") || undefined,
        q: c.req.query("q") || undefined,
        limit,
      }),
    );
  });

  app.get("/api/stickers/packs", (c) => {
    const settings = loadSettings();
    return c.json({
      ok: true,
      packId: activePackId(),
      enabledPacks: settings.enabledPacks,
      packs: listPacks(),
    });
  });

  app.get("/api/stickers/settings", (c) => c.json({ ok: true, settings: loadSettings() }));

  app.post("/api/stickers/settings", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof body.packId === "string") {
      if (!getPack(body.packId)) return c.json({ detail: "图库不存在" }, 404);
      patch.packId = body.packId;
    }
    if (Array.isArray(body.enabledPacks)) {
      patch.enabledPacks = body.enabledPacks.filter(
        (id): id is string => typeof id === "string" && isSafePackId(id) && Boolean(getPack(id)),
      );
    }
    for (const key of ["layoutMode", "pickerSendOnClick", "pickerAttachImage", "sendGear", "sendMode", "promptEnabled", "remoteDirUrl"]) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    const settings = saveSettings(patch as never);
    return c.json({ ok: true, settings });
  });

  app.patch("/api/stickers/packs/:id", async (c) => {
    const id = c.req.param("id");
    if (!isSafePackId(id) || !getPack(id)) return c.json({ detail: "图库不存在" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") return c.json({ detail: "enabled 必须是布尔值" }, 400);
    const settings = setPackEnabled(id, body.enabled);
    return c.json({ ok: true, settings });
  });

  app.get("/api/stickers/market", async (c) => {
    if (stickerInitError()) return c.json({ detail: stickerInitError() }, 500);
    const data = await fetchMarketCatalog(c.req.query("refresh") === "1");
    return c.json({ ...data, ok: data.ok }, data.ok ? 200 : 502);
  });

  async function installHandler(c: Context) {
    const body = (await c.req.json().catch(() => ({}))) as {
      archiveUrl?: string;
      sha256?: string;
      id?: string;
      name?: string;
      version?: string;
    };
    try {
      let archiveUrl = body.archiveUrl;
      let sha256 = body.sha256;
      let id = body.id;
      // 两个入口：目录条目 {id}（市场卡片点击）或手填 {archiveUrl, sha256}（远端/测试）。
      if ((!archiveUrl || !sha256) && id) {
        const catalog = await fetchMarketCatalog();
        const entry = catalog.packs.find((p) => p.id === id);
        if (!entry) return c.json({ detail: "市场目录里没有该图库" }, 404);
        archiveUrl = entry.archiveUrl;
        sha256 = entry.sha256;
        id = entry.id;
        body.name ||= entry.name;
        body.version ||= entry.version;
      }
      if (!archiveUrl || !sha256) return c.json({ detail: "需要 id，或 archiveUrl 与 sha256" }, 400);
      const result = await installRemotePack({
        archiveUrl,
        sha256,
        id,
        name: body.name,
        version: body.version,
      });
      return c.json({ ok: true, ...result });
    } catch (err) {
      return c.json({ detail: err instanceof Error ? err.message : String(err) }, 400);
    }
  }

  app.post("/api/stickers/packs/install", installHandler);
  app.post("/api/stickers/market/install", installHandler);

  app.post("/api/stickers/market/update", installHandler);

  app.post("/api/stickers/packs/import", async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return c.json({ detail: "缺少 ZIP 文件" }, 400);
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length === 0 || buf.length > 200 * 1024 * 1024) return c.json({ detail: "ZIP 大小超限" }, 400);
    const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
    try {
      const result = installArchiveBuffer(buf, {
        archiveUrl: `upload:${file.name || "pack.zip"}`,
        sha256,
        requestedId: typeof form?.get("id") === "string" ? String(form.get("id")) : undefined,
      });
      return c.json({ ok: true, ...result });
    } catch (err) {
      return c.json({ detail: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.get("/api/stickers/packs/:id/export", (c) => {
    const id = c.req.param("id");
    if (!isSafePackId(id)) return c.json({ detail: "非法图库 id" }, 400);
    try {
      const { filename, buffer } = exportPack(id);
      return new Response(buffer, {
        headers: {
          "content-type": "application/zip",
          "content-disposition": `attachment; filename="${filename}"`,
          "cache-control": "no-store",
        },
      });
    } catch (err) {
      return c.json({ detail: err instanceof Error ? err.message : String(err) }, 404);
    }
  });

  function deletePackHandler(c: Context) {
    const id = c.req.param("id");
    if (!id || !isSafePackId(id)) return c.json({ detail: "非法图库 id" }, 400);
    try {
      if (!deleteRemotePack(id)) {
        return c.json({ detail: "只能删除带远程来源标记的图库" }, 409);
      }
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ detail: err instanceof Error ? err.message : String(err) }, 400);
    }
  }

  app.delete("/api/stickers/packs/:id", deletePackHandler);
  app.post("/api/stickers/packs/:id/delete", deletePackHandler);

  app.post("/api/stickers/packs/:id/scan", (c) => {
    const id = c.req.param("id");
    if (!isSafePackId(id) || !getPack(id)) return c.json({ detail: "图库不存在" }, 404);
    try {
      const result = scanPack(id);
      return c.json({ ok: true, ...result });
    } catch (err) {
      return c.json({ detail: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.post("/api/stickers/packs/:id/activate", (c) => {
    const id = c.req.param("id");
    if (!isSafePackId(id) || !getPack(id)) return c.json({ detail: "图库不存在" }, 404);
    return c.json({ ok: true, settings: setActivePack(id) });
  });

  app.post("/api/stickers/upload", async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return c.json({ detail: "缺少文件" }, 400);
    const tag = typeof form?.get("tag") === "string" ? String(form.get("tag")) : undefined;
    const caption = typeof form?.get("caption") === "string" ? String(form.get("caption")) : undefined;
    const keywords = typeof form?.get("keywords") === "string" ? String(form.get("keywords")) : undefined;
    try {
      const result = await uploadSticker(file as File, { tag, caption, keywords });
      return c.json(result);
    } catch (err) {
      return c.json({ detail: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.post("/api/stickers/memes/update", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      packId?: string;
      path?: string;
      tag?: string;
      caption?: string;
      keywords?: string;
    };
    const packId = body.packId || USER_PACK_ID;
    if (!isSafePackId(packId)) return c.json({ detail: "非法图库 id" }, 400);
    if (!body.path || !isSafeRelPath(body.path)) return c.json({ detail: "非法路径" }, 400);
    if (body.tag === undefined && body.caption === undefined && body.keywords === undefined) {
      return c.json({ detail: "至少提供 tag/caption/keywords 之一" }, 400);
    }
    try {
      const ok = updateMeme(packId, body.path, {
        tag: body.tag,
        caption: body.caption,
        keywords: body.keywords,
      });
      return ok ? c.json({ ok: true }) : c.json({ detail: "表情不存在" }, 404);
    } catch (err) {
      return c.json({ detail: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.delete("/api/stickers/memes", (c) => {
    const packId = c.req.query("packId") || USER_PACK_ID;
    const rel = c.req.query("path") || "";
    if (!isSafePackId(packId)) return c.json({ detail: "非法图库 id" }, 400);
    if (!isSafeRelPath(rel)) return c.json({ detail: "非法路径" }, 400);
    try {
      const ok = deleteMeme(packId, rel);
      return ok ? c.json({ ok: true }) : c.json({ detail: "表情不存在" }, 404);
    } catch (err) {
      return c.json({ detail: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.get("/api/stickers/health", (c) => {
    const packs = listPacks();
    return c.json({
      ok: !stickerInitError(),
      error: stickerInitError(),
      migration: migrationStatus(),
      packs: packs.map((p) => ({
        id: p.id,
        name: p.name,
        count: p.count,
        source: p.source,
        path: p.path,
      })),
    });
  });

  // ── 旧兼容接口 ──────────────────────────────────────────────────────────

  app.get("/api/stickers/legacy/index", (c) => c.json({ index: legacyIndex() }));

  app.get("/api/stickers/random/:category", (c) => {
    const category = c.req.param("category");
    if (!CATEGORY_RE.test(category)) return c.json({ detail: "非法分类名" }, 400);
    const item = randomByCategory(category);
    if (!item) return c.json({ detail: "该分类无表情" }, 404);
    return c.json(item);
  });

  app.get("/api/stickers", (c) => {
    return c.json({ categories: legacyCategories(), packs: listPacks(), packId: activePackId() });
  });

  app.get("/api/stickers/favorites", (c) => {
    const favorites = legacyFavorites();
    return c.json({ favorites });
  });

  app.post("/api/stickers/favorites", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const ref = favoriteRefOf(body);
    const invalid = validateLegacyRef(ref.category, ref.filename);
    if (invalid) return c.json({ detail: invalid }, 400);
    if (!legacyResolve(ref.category, ref.filename)) return c.json({ detail: "表情不存在" }, 404);
    const favorites = legacyFavorites();
    if (favorites.some((f) => f.category === ref.category && f.filename === ref.filename)) {
      return c.json({ success: false, message: "已在收藏中" });
    }
    const next = [
      ...favorites.map((f) => ({ category: f.category, filename: f.filename, added_at: f.added_at })),
      { category: ref.category, filename: ref.filename, added_at: new Date().toISOString() },
    ];
    writeYamlAtomic(legacyFavoritesPath(), { favorites: next });
    return c.json({ success: true, message: "已收藏" });
  });

  app.delete("/api/stickers/favorites", (c) => {
    const filename = c.req.query("filename") || "";
    const category = c.req.query("category") || "";
    const favorites = legacyFavorites();
    const next = favorites.filter((f) => !(f.filename === filename && f.category === category));
    if (next.length === favorites.length) return c.json({ success: false, message: "未找到收藏" });
    writeYamlAtomic(
      legacyFavoritesPath(),
      { favorites: next.map((f) => ({ category: f.category, filename: f.filename, added_at: f.added_at })) },
    );
    return c.json({ success: true, message: "已取消收藏" });
  });

  app.post("/api/stickers/usage", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const ref = favoriteRefOf(body);
    if (!legacyResolve(ref.category, ref.filename)) return c.json({ detail: "表情不存在" }, 404);
    addRecent({ path: `${ref.category}/${ref.filename}`, category: ref.category, filename: ref.filename, used_at: new Date().toISOString() });
    return c.json({ success: true, message: "已记录使用" });
  });

  app.post("/api/stickers/skip", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const ref = favoriteRefOf(body);
    if (!legacyResolve(ref.category, ref.filename)) return c.json({ detail: "表情不存在" }, 404);
    return c.json({ success: true, message: "已减少推荐" });
  });

  app.get("/api/stickers/recent", (c) => {
    const limit = Math.max(1, Math.min(100, Number(c.req.query("limit") || 50)));
    const legacy = legacyRecent();
    const fresh = recentItems();
    const merged = [...fresh, ...legacy].slice(0, limit);
    return c.json({ recent: merged });
  });

  app.get("/api/stickers/recommendations", (c) => {
    const limit = Math.max(1, Math.min(12, Number(c.req.query("limit") || 4)));
    return c.json({ recommendations: recommendations(limit) });
  });

  app.get("/api/stickers/custom", (c) => {
    const stickers: Array<{ category: string; filename: string; path: string; packId: string }> = [];
    for (const packId of [USER_PACK_ID, LEGACY_CUSTOM_PACK_ID]) {
      const store = getStore(packId);
      for (const row of store?.rows || []) {
        stickers.push({ category: "custom", filename: row.file_name, path: row.path, packId });
      }
    }
    return c.json({ stickers });
  });

  app.delete("/api/stickers/custom/:filename", (c) => {
    const filename = c.req.param("filename");
    if (!FILENAME_RE.test(filename) || !/^(?:custom_|sticker_)/.test(filename)) {
      return c.json({ detail: "非法文件名" }, 400);
    }
    for (const packId of [USER_PACK_ID, LEGACY_CUSTOM_PACK_ID]) {
      const row = getStore(packId)?.rows.find((r) => r.file_name === filename);
      if (!row) continue;
      try {
        const ok = deleteMeme(packId, row.path);
        return ok ? c.json({ success: true, message: "已删除" }) : c.json({ detail: "表情不存在" }, 404);
      } catch (err) {
        return c.json({ detail: err instanceof Error ? err.message : String(err) }, 400);
      }
    }
    return c.json({ detail: "表情不存在" }, 404);
  });

  // 旧图片 URL：必须放在 random 之后、其它具体路由之后。
  app.get("/api/stickers/:category/:filename", (c) => {
    const category = c.req.param("category");
    const filename = c.req.param("filename");
    if (!CATEGORY_RE.test(category)) return c.json({ detail: "非法分类名" }, 400);
    if (!FILENAME_RE.test(filename)) return c.json({ detail: "非法文件名" }, 400);
    const file = legacyResolve(category, filename);
    if (!file) return c.json({ detail: "贴纸不存在" }, 404);
    return imageResponse(file, c.req.raw.headers);
  });

  return app;
}

/** 回滚开关 MAXMA_STICKER_ENGINE=legacy 时使用的旧协议图片/列表路由（不覆盖旧 index/favorites）。 */
export function createLegacyStickerCompatRoutes(): Hono {
  const app = new Hono();
  app.use("/api/stickers/*", async (_c, next) => {
    initStickerSystem();
    await next();
  });
  app.get("/api/stickers/random/:category", (c) => {
    const category = c.req.param("category");
    if (!CATEGORY_RE.test(category)) return c.json({ detail: "非法分类名" }, 400);
    const item = randomByCategory(category);
    if (!item) return c.json({ detail: "该分类无表情" }, 404);
    return c.json(item);
  });
  app.get("/api/stickers", (c) => {
    return c.json({ categories: legacyCategories(), packs: listPacks(), packId: activePackId() });
  });
  app.get("/api/stickers/:category/:filename", (c) => {
    const category = c.req.param("category");
    const filename = c.req.param("filename");
    if (!CATEGORY_RE.test(category)) return c.json({ detail: "非法分类名" }, 400);
    if (!FILENAME_RE.test(filename)) return c.json({ detail: "非法文件名" }, 400);
    const file = legacyResolve(category, filename);
    if (!file) return c.json({ detail: "贴纸不存在" }, 404);
    return imageResponse(file, c.req.raw.headers);
  });
  return app;
}

/** 兼容旧 server 引用名；以后可删。 */
export function createStickerFileRoutes(): Hono {
  return createStickerRoutes();
}

export function stickersDir(): string {
  return path.join(requireBundle(), "config", "stickers");
}
export function customStickersDir(): string {
  return path.join(dataDir(), "config", "stickers", "custom");
}
function requireBundle(): string {
  return path.resolve(process.env.MAXMA_BUNDLE_DIR ?? path.join(import.meta.dir, "..", "..", ".."));
}
