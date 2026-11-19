/**
 * Maxma 表情系统服务层：pack 生命周期、索引查询、上传/扫描/删除、旧数据兼容。
 *
 * 存储模型完全采用 dsh-meme：一个图库目录 = index.db + manifest.json + 图片。
 * 不引入全局 stickers.db，不引入内容寻址 blob。
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import sharp from "sharp";

import {
  BUILTIN_PACK_ID,
  LEGACY_CUSTOM_PACK_ID,
  USER_PACK_ID,
  backupDir,
  builtinPackDir,
  legacyCustomPackDir,
  legacyCustomSourceDir,
  legacyFavoritesPath,
  legacyPreferencesPath,
  legacyRecentPath,
  packsDir,
  recentPath,
  settingsPath,
  stickersDataRoot,
  userPackDir,
} from "./paths";
import { buildBuiltinPack, builtinIndexIsCurrent } from "./build";
import {
  ensurePackAt,
  enabledPackIds as filterEnabledPacks,
  legacyTagForCategory,
  MemesStore,
  normalizeLayoutMode,
  normalizeSendMode,
  openIndexWriter,
  PackMeta,
  walkPackImages,
} from "../../../bun-shared/dsh-meme/memes";

const IMAGE_EXTS = new Set([".webp", ".png", ".jpg", ".jpeg", ".gif"]);
const MAX_UPLOAD = 8 * 1024 * 1024;
const MAX_DIMENSION = 4096;
const TAG_RE = /^[a-z0-9_-]{1,40}$/;

export interface StickerSettings {
  packId: string;
  enabledPacks: string[];
  layoutMode: "inline" | "stacked";
  pickerSendOnClick: boolean;
  pickerAttachImage: boolean;
  sendGear: "off" | "auto" | "active" | "always";
  sendMode: "auto" | "text" | "image";
  promptEnabled: boolean;
  remoteDirUrl: string;
  remoteSubs: string[];
  updatedAt: number;
}

const DEFAULT_SETTINGS: StickerSettings = {
  packId: BUILTIN_PACK_ID,
  enabledPacks: [BUILTIN_PACK_ID, USER_PACK_ID, LEGACY_CUSTOM_PACK_ID],
  layoutMode: "inline",
  pickerSendOnClick: true,
  pickerAttachImage: false,
  sendGear: "auto",
  sendMode: "auto",
  promptEnabled: true,
  remoteDirUrl: "",
  remoteSubs: [],
  updatedAt: 0,
};

const storeCache = new Map<string, { mtimeMs: number; store: MemesStore }>();

let initialized = false;
let initializedFor = "";
let initError: string | null = null;

function safeJsonRead<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
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

function normalizeSendGear(value: unknown): StickerSettings["sendGear"] {
  return value === "off" || value === "active" || value === "always" ? value : "auto";
}

export function loadSettings(): StickerSettings {
  const raw = safeJsonRead<Partial<StickerSettings>>(settingsPath(), {});
  const enabled = Array.isArray(raw.enabledPacks)
    ? raw.enabledPacks.map(String)
    : DEFAULT_SETTINGS.enabledPacks;
  return {
    packId: typeof raw.packId === "string" && raw.packId ? raw.packId : DEFAULT_SETTINGS.packId,
    enabledPacks: enabled,
    layoutMode: normalizeLayoutMode(raw.layoutMode),
    pickerSendOnClick:
      typeof raw.pickerSendOnClick === "boolean"
        ? raw.pickerSendOnClick
        : DEFAULT_SETTINGS.pickerSendOnClick,
    pickerAttachImage:
      typeof raw.pickerAttachImage === "boolean"
        ? raw.pickerAttachImage
        : DEFAULT_SETTINGS.pickerAttachImage,
    sendGear: normalizeSendGear(raw.sendGear),
    sendMode: normalizeSendMode(raw.sendMode),
    promptEnabled:
      typeof raw.promptEnabled === "boolean" ? raw.promptEnabled : DEFAULT_SETTINGS.promptEnabled,
    remoteDirUrl: typeof raw.remoteDirUrl === "string" ? raw.remoteDirUrl : "",
    remoteSubs: Array.isArray(raw.remoteSubs) ? raw.remoteSubs.map(String) : [],
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

export function saveSettings(patch: Partial<StickerSettings>): StickerSettings {
  const current = loadSettings();
  const next: StickerSettings = {
    ...current,
    ...patch,
    packId: typeof patch.packId === "string" && patch.packId ? patch.packId : current.packId,
    enabledPacks: Array.isArray(patch.enabledPacks)
      ? [...new Set(patch.enabledPacks.map(String))]
      : current.enabledPacks,
    layoutMode: patch.layoutMode ? normalizeLayoutMode(patch.layoutMode) : current.layoutMode,
    sendGear: patch.sendGear ? normalizeSendGear(patch.sendGear) : current.sendGear,
    sendMode: patch.sendMode ? normalizeSendMode(patch.sendMode) : current.sendMode,
    updatedAt: Date.now(),
  };
  writeJsonAtomic(settingsPath(), next);
  return next;
}

export function initStickerSystem(): void {
  // 测试/便携启动会改 MAXMA_BUNDLE_DIR / MAXMA_DATA_DIR；按根路径重新初始化。
  const key = `${builtinPackDir()}|${stickersDataRoot()}`;
  if (initialized && initializedFor === key) return;
  initialized = true;
  initializedFor = key;
  initError = null;
  try {
    fs.mkdirSync(stickersDataRoot(), { recursive: true });
    fs.mkdirSync(packsDir(), { recursive: true });
    // 内置索引：开发模式自动生成；只读便携包由构建脚本预生成。
    try {
      if (!builtinIndexIsCurrent(builtinPackDir())) {
        buildBuiltinPack(builtinPackDir());
      }
    } catch (err) {
      initError = `内置表情索引生成失败: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[stickers]", initError);
    }
    ensurePackAt(userPackDir(), {
      id: USER_PACK_ID,
      name: "我的收藏",
      description: "上传/学图/收藏的稳定图库",
    });
    runStickerMigration();
    // 首次运行写入默认设置，后续尊重用户已有设置。
    if (!fs.existsSync(settingsPath())) {
      writeJsonAtomic(settingsPath(), { ...DEFAULT_SETTINGS, updatedAt: Date.now() });
    }
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    console.error("[stickers] init failed", err);
  }
}

export function stickerInitError(): string | null {
  return initError;
}

/** 把旧 data/config/stickers/custom 复制到 legacy pack；不删原文件。 */
export function migrateLegacyCustom(): { copied: number; skipped: number } {
  const src = legacyCustomSourceDir();
  const dst = legacyCustomPackDir();
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) return { copied: 0, skipped: 0 };
  ensurePackAt(dst, {
    id: LEGACY_CUSTOM_PACK_ID,
    name: "旧自定义表情（兼容）",
    description: "从旧 custom 目录迁移，仅用于兼容旧消息",
  });
  const files = fs
    .readdirSync(src)
    .filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()));
  let copied = 0;
  let skipped = 0;
  const writer = openIndexWriter(dst);
  try {
    for (const file of files) {
      const rel = `custom/${file}`;
      const target = path.join(dst, "custom", file);
      if (fs.existsSync(target)) {
        skipped++;
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(src, file), target);
        copied++;
      }
      const exists = writer.prepare("SELECT path FROM memes WHERE path = ?").get(rel);
      if (!exists) {
        writer
          .prepare(
            "INSERT OR REPLACE INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(rel, "daily", file, path.basename(file, path.extname(file)).slice(0, 200), "custom", Date.now(), null);
      }
    }
  } finally {
    writer.close();
  }
  return { copied, skipped };
}

export interface StickerMigrationReport {
  version: 1;
  at: number;
  backupDir: string;
  ok: boolean;
  custom: { copied: number; skipped: number };
  favorites: { copied: number; skipped: number };
  recent: { migrated: boolean; count: number };
  reconcile: {
    builtinRows: number;
    builtinImages: number;
    legacyRows: number;
    legacyImages: number;
    oldUrlsChecked: number;
    oldUrlsOk: number;
  };
  errors: string[];
}

function migrationMarkerPath(): string {
  return path.join(stickersDataRoot(), "migration.json");
}

function copyIfExists(src: string, dst: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try {
    fs.cpSync(src, dst, { recursive: true });
  } catch (err) {
    throw new Error(`备份失败 ${path.basename(src)}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * 旧数据迁移（M0-M5）。只复制/索引，不删除旧 YAML、custom 或内置图片。
 * 迁移结果写入 data/stickers/migration.json；失败只记录，不阻断新系统启动。
 */
export function runStickerMigration(): StickerMigrationReport {
  const marker = migrationMarkerPath();
  if (fs.existsSync(marker)) {
    try {
      return JSON.parse(fs.readFileSync(marker, "utf8")) as StickerMigrationReport;
    } catch {
      /* 损坏的 marker 走重建 */
    }
  }
  const at = Date.now();
  const backup = backupDir(at);
  const errors: string[] = [];
  const report: StickerMigrationReport = {
    version: 1,
    at,
    backupDir: backup,
    ok: false,
    custom: { copied: 0, skipped: 0 },
    favorites: { copied: 0, skipped: 0 },
    recent: { migrated: false, count: 0 },
    reconcile: { builtinRows: 0, builtinImages: 0, legacyRows: 0, legacyImages: 0, oldUrlsChecked: 0, oldUrlsOk: 0 },
    errors,
  };
  try {
    // M0 备份：旧 custom + 三个 YAML；备份失败仍不阻断读取旧数据。
    copyIfExists(legacyCustomSourceDir(), path.join(backup, "config", "stickers", "custom"));
    for (const file of [legacyFavoritesPath(), legacyRecentPath(), legacyPreferencesPath()]) {
      copyIfExists(file, path.join(backup, "api", "data", path.basename(file)));
    }
    // M2 旧 custom → maxma_legacy_custom（原地原文件保留）。
    report.custom = migrateLegacyCustom();
    // M3 用户 pack 由 initStickerSystem 的 ensurePackAt 创建；这里确保以支持独立调用。
    ensurePackAt(userPackDir(), { id: USER_PACK_ID, name: "我的收藏" });

    // M4 旧 YAML favorites → dsh-meme-user：复制图片并写索引行。
    const favorites = legacyFavorites();
    if (favorites.length > 0) {
      const writer = openIndexWriter(userPackDir());
      try {
        for (const fav of favorites) {
          const category = String(fav.category || "");
          const filename = String(fav.filename || "");
          if (!CATEGORY_SAFE_RE.test(category) || !filename || filename.includes("/") || filename.includes("\\")) {
            report.favorites.skipped++;
            continue;
          }
          const src = path.join(builtinPackDir(), category, filename);
          if (!fs.existsSync(src) || !IMAGE_EXTS.has(path.extname(filename).toLowerCase())) {
            report.favorites.skipped++;
            continue;
          }
          const tag = legacyTagForCategory(category) || "daily";
          const rel = `memes/${tag}/${filename}`;
          const dst = path.join(userPackDir(), "memes", tag, filename);
          if (fs.existsSync(dst)) {
            report.favorites.skipped++;
            continue;
          }
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(src, dst);
          writer
            .prepare(
              "INSERT OR REPLACE INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .run(rel, tag, filename, path.basename(filename, path.extname(filename)), category, Date.now(), null);
          report.favorites.copied++;
        }
      } catch (err) {
        errors.push(`favorites: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        writer.close();
      }
    }

    // M4 旧 recent YAML → data/stickers/recent.json；已有新文件则不覆盖。
    try {
      const yamlRecent = safeJsonRead<{ recent?: Array<Record<string, unknown>> }>(recentPath(), { recent: [] });
      if (!fs.existsSync(recentPath()) && fs.existsSync(legacyRecentPath())) {
        const parsed = Bun.YAML.parse(fs.readFileSync(legacyRecentPath(), "utf8")) as {
          recent?: Array<Record<string, unknown>>;
        } | null;
        if (Array.isArray(parsed?.recent)) {
          writeJsonAtomic(recentPath(), { recent: parsed.recent });
          report.recent = { migrated: true, count: parsed.recent.length };
        }
      } else {
        report.recent = { migrated: false, count: Array.isArray(yamlRecent.recent) ? yamlRecent.recent.length : 0 };
      }
      void yamlRecent;
    } catch (err) {
      errors.push(`recent: ${err instanceof Error ? err.message : String(err)}`);
    }

    // M5 对账 + 旧 URL 抽样（只证明 shim 能解析，不访问 HTTP）。
    try {
      const builtinStore = getStore(BUILTIN_PACK_ID);
      const legacyStore = getStore(LEGACY_CUSTOM_PACK_ID);
      report.reconcile.builtinRows = builtinStore?.rows.length || 0;
      // builtin pack 的扫描根包含旧的 custom 子目录；custom 由 maxma_legacy_custom 负责。
      report.reconcile.builtinImages = walkPackImages(builtinPackDir()).filter((rel) => !rel.startsWith("custom/")).length;
      report.reconcile.legacyRows = legacyStore?.rows.length || 0;
      report.reconcile.legacyImages = walkPackImages(legacyCustomPackDir()).length;
      const samples = (builtinStore?.rows || []).slice(0, 200);
      report.reconcile.oldUrlsChecked = samples.length;
      for (const row of samples) {
        const category = row.path.split("/")[0] || "";
        if (legacyResolve(category, row.file_name)) report.reconcile.oldUrlsOk++;
      }
      if (report.reconcile.builtinRows !== report.reconcile.builtinImages) {
        errors.push(`内置对账失败: rows=${report.reconcile.builtinRows} images=${report.reconcile.builtinImages}`);
      }
      if (report.custom.copied + report.custom.skipped > 0 && report.reconcile.legacyRows !== report.reconcile.legacyImages) {
        errors.push(`旧 custom 对账失败: rows=${report.reconcile.legacyRows} images=${report.reconcile.legacyImages}`);
      }
    } catch (err) {
      errors.push(`reconcile: ${err instanceof Error ? err.message : String(err)}`);
    }
    report.ok = errors.length === 0;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    report.ok = false;
  }
  try {
    writeJsonAtomic(marker, report);
  } catch {
    /* marker 写失败不阻断启动 */
  }
  return report;
}

export function migrationStatus(): StickerMigrationReport | null {
  try {
    return JSON.parse(fs.readFileSync(migrationMarkerPath(), "utf8")) as StickerMigrationReport;
  } catch {
    return null;
  }
}

const CATEGORY_SAFE_RE = /^[\w\u4e00-\u9fff-]+$/;

export function listPacks(): PackMeta[] {
  initStickerSystem();
  return scanPacksAll().map((pack) => ({
    ...pack,
    enabled: settingsEnabledIds().includes(pack.id),
  }) as PackMeta & { enabled: boolean });
}

function scanPacksAll(): PackMeta[] {
  // 直接 import 的函数会读 module 位置；Maxma 必须显式传两个根。
  const { scanPacks } = requireShared();
  const packs = scanPacks(builtinPackDir(), packsDir());
  // 内置目录物理名是 config/stickers；对外稳定 id 必须是 maxma_builtin。
  return packs.map((pack) =>
    path.resolve(pack.path) === path.resolve(builtinPackDir())
      ? { ...pack, id: BUILTIN_PACK_ID }
      : pack,
  );
}

// 避免循环依赖的薄封装；shared 模块是纯函数，不依赖本模块。
import * as shared from "../../../bun-shared/dsh-meme/memes";
function requireShared() {
  return shared;
}

export function settingsEnabledIds(): string[] {
  const settings = loadSettings();
  const packs = scanPacksAll();
  const active = packs.some((p) => p.id === settings.packId) ? settings.packId : packs[0]?.id || "";
  const ids = filterEnabledPacks(settings as never, packs, active);
  return ids.length > 0 ? ids : active ? [active] : [];
}

export function activePackId(): string {
  const settings = loadSettings();
  const packs = scanPacksAll();
  if (packs.some((p) => p.id === settings.packId)) return settings.packId;
  return packs.find((p) => p.id === BUILTIN_PACK_ID)?.id || packs[0]?.id || BUILTIN_PACK_ID;
}

export function getPack(packId: string): PackMeta | null {
  return scanPacksAll().find((p) => p.id === packId) || null;
}

export function getStore(packId: string): MemesStore | null {
  const pack = getPack(packId);
  if (!pack) return null;
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(path.join(pack.path, "index.db")).mtimeMs;
  } catch {
    mtimeMs = Date.now();
  }
  const hit = storeCache.get(pack.id);
  if (hit && hit.mtimeMs === mtimeMs) return hit.store;
  try {
    const store = new MemesStore(pack.path);
    storeCache.set(pack.id, { mtimeMs, store });
    return store;
  } catch (err) {
    console.error(`[stickers] 读取图库失败 ${pack.id}`, err);
    return null;
  }
}

export function invalidateStore(packId?: string): void {
  if (packId) storeCache.delete(packId);
  else storeCache.clear();
}

export function packUrl(packId: string, rel: string): string {
  return `/api/stickers/file/${encodeURIComponent(packId)}/${rel
    .split("/")
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join("/")}`;
}

export function isSafeRelPath(rel: string): boolean {
  const posix = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!posix || posix.includes("\0")) return false;
  if (posix.includes("..")) return false;
  if (posix.startsWith("/") || /^[a-zA-Z]:/.test(posix)) return false;
  const segs = posix.split("/");
  return segs.every((s) => s && s !== "." && s !== "..");
}

export function resolveMemeFile(packId: string, rel: string): string | null {
  if (!isSafeRelPath(rel)) return null;
  const pack = getPack(packId);
  const store = getStore(packId);
  if (!pack || !store) return null;
  const row = store.rows.find((r) => r.path === rel.replace(/\\/g, "/"));
  if (!row) return null;
  try {
    return store.resolveStored(row.path);
  } catch {
    return null;
  }
}

export function legacyResolve(category: string, filename: string): string | null {
  const rel = `${category}/${filename}`;
  const direct = resolveMemeFile(BUILTIN_PACK_ID, rel);
  if (direct) return direct;
  return resolveMemeFile(LEGACY_CUSTOM_PACK_ID, `custom/${filename}`);
}

export interface IndexMeme {
  packId: string;
  packName: string;
  path: string;
  url: string;
  tag: string;
  caption: string;
  keywords: string;
  file_name: string;
}

export function indexPayload(opts: {
  packId?: string;
  tag?: string;
  q?: string;
  limit?: number;
}): {
  ok: boolean;
  total: number;
  tags: Array<{ tag: string; count: number; mood?: string }>;
  packs: Array<PackMeta & { enabled: boolean }>;
  memes: IndexMeme[];
} {
  initStickerSystem();
  const settings = loadSettings();
  const enabled = settingsEnabledIds();
  const requested = opts.packId && opts.packId !== "all" ? opts.packId : "all";
  const ids = requested === "all" ? enabled : [requested];
  const packs = listPacks();
  const tagCounts = new Map<string, number>();
  const rows: IndexMeme[] = [];
  for (const id of ids) {
    const pack = packs.find((p) => p.id === id);
    const store = getStore(id);
    if (!pack || !store) continue;
    const listed = store.list(opts.tag, opts.q, Boolean(opts.tag));
    for (const m of listed.memes) {
      tagCounts.set(m.tag, (tagCounts.get(m.tag) || 0) + 1);
      rows.push({
        packId: id,
        packName: pack.name,
        path: m.path,
        url: packUrl(id, m.path),
        tag: m.tag,
        caption: m.caption || m.file_name || "",
        keywords: m.keywords || "",
        file_name: m.file_name,
      });
    }
  }
  // 去重：同一 pack/path 只留一条；跨 pack 同 path 仍保留（来源不同）。
  const unique = new Map<string, IndexMeme>();
  for (const row of rows) unique.set(`${row.packId}\u0000${row.path}`, row);
  const all = [...unique.values()];
  const limit = Math.max(1, Math.min(5000, Number(opts.limit) || 2000));
  const tags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }));
  return {
    ok: true,
    total: all.length,
    tags,
    packs,
    memes: all.slice(0, limit),
  };
}

export function legacyIndex(): Record<string, unknown> {
  initStickerSystem();
  const out: Record<string, unknown> = {};
  for (const id of [BUILTIN_PACK_ID, LEGACY_CUSTOM_PACK_ID]) {
    const store = getStore(id);
    if (!store) continue;
    for (const row of store.rows) {
      const category = row.path.startsWith("custom/") ? "custom" : row.path.split("/")[0] || "custom";
      const filename = row.file_name;
      out[row.path] = { category, filename, path: row.path };
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

export function scanPack(packId: string): { added: number; removed: number } {
  const pack = getPack(packId);
  if (!pack) throw new Error("图库不存在");
  if (pack.source === "bundled") throw new Error("内置图库请用构建脚本重建索引");
  const files = walkPackImages(pack.path);
  const writer = openIndexWriter(pack.path);
  let added = 0;
  let removed = 0;
  try {
    const existing = writer.prepare("SELECT path FROM memes").all() as Array<{ path: string }>;
    const existingSet = new Set(existing.map((r) => r.path));
    const fileSet = new Set(files);
    for (const rel of files) {
      if (existingSet.has(rel)) continue;
      const row = shared.scanRowFor(rel);
      let mtime = Date.now();
      try {
        mtime = fs.statSync(path.join(pack.path, rel)).mtimeMs;
      } catch {
        /* ignore */
      }
      writer
        .prepare(
          "INSERT OR REPLACE INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(row.path, row.tag, row.file_name, row.caption, "", mtime, null);
      added++;
    }
    for (const row of existing) {
      if (fileSet.has(row.path)) continue;
      writer.prepare("DELETE FROM memes WHERE path = ?").run(row.path);
      removed++;
    }
  } finally {
    writer.close();
    invalidateStore(packId);
  }
  return { added, removed };
}

export async function uploadSticker(
  file: File,
  opts: { tag?: string; caption?: string; keywords?: string } = {},
): Promise<{ success: boolean; path: string; filename: string; message: string; packId: string }> {
  initStickerSystem();
  const name = file.name || "upload";
  const ext = path.extname(name).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) throw new Error(`不支持的文件格式: ${ext}`);
  const content = Buffer.from(await file.arrayBuffer());
  if (content.length > MAX_UPLOAD) throw new Error(`文件过大，最大 ${MAX_UPLOAD / 1024 / 1024}MB`);
  try {
    const meta = await sharp(content, ext === ".gif" ? { animated: true } : undefined).metadata();
    if (meta.width && meta.width > MAX_DIMENSION) throw new Error("图片宽度超过 4096");
    if (meta.height && meta.height > MAX_DIMENSION) throw new Error("图片高度超过 4096");
  } catch (err) {
    if (err instanceof Error && /超过 4096/.test(err.message)) throw err;
    throw new Error("图片解码失败，不是有效图片");
  }
  const rawTag = String(opts.tag || "daily").trim().toLowerCase();
  const tag = TAG_RE.test(rawTag) ? rawTag : legacyTagForCategory(rawTag);
  const hash = crypto.createHash("md5").update(content).digest("hex").slice(0, 16);
  const filename = `sticker_${hash}${ext}`;
  const rel = `memes/${tag}/${filename}`;
  const dst = path.join(userPackDir(), ...rel.split("/"));
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const wasNew = !fs.existsSync(dst);
  if (wasNew) fs.writeFileSync(dst, content);
  const writer = openIndexWriter(userPackDir());
  try {
    const exists = writer.prepare("SELECT path FROM memes WHERE path = ?").get(rel);
    if (!exists) {
      writer
        .prepare(
          "INSERT OR REPLACE INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          rel,
          tag,
          filename,
          String(opts.caption || path.basename(filename, ext)).slice(0, 200),
          String(opts.keywords || tag).slice(0, 200),
          Date.now(),
          null,
        );
    }
  } finally {
    writer.close();
    invalidateStore(USER_PACK_ID);
  }
  return {
    success: true,
    packId: USER_PACK_ID,
    path: rel,
    filename,
    message: wasNew ? "上传成功" : "文件已存在（重复上传）",
  };
}

export function updateMeme(
  packId: string,
  rel: string,
  patch: { tag?: string; caption?: string; keywords?: string },
): boolean {
  const pack = getPack(packId);
  if (!pack || pack.source === "bundled") throw new Error("内置图库不可编辑");
  if (!isSafeRelPath(rel)) throw new Error("路径非法");
  const writer = openIndexWriter(pack.path);
  try {
    const row = writer.prepare("SELECT path FROM memes WHERE path = ?").get(rel);
    if (!row) return false;
    if (patch.tag !== undefined) {
      const tag = String(patch.tag).trim().toLowerCase();
      if (!TAG_RE.test(tag)) throw new Error("非法 tag");
      writer.prepare("UPDATE memes SET tag = ? WHERE path = ?").run(tag, rel);
    }
    if (patch.caption !== undefined) {
      writer.prepare("UPDATE memes SET caption = ? WHERE path = ?").run(String(patch.caption).slice(0, 200), rel);
    }
    if (patch.keywords !== undefined) {
      writer.prepare("UPDATE memes SET keywords = ? WHERE path = ?").run(String(patch.keywords).slice(0, 200), rel);
    }
    return true;
  } finally {
    writer.close();
    invalidateStore(packId);
  }
}

export function deleteMeme(packId: string, rel: string): boolean {
  const pack = getPack(packId);
  if (!pack || pack.source === "bundled") throw new Error("内置图库不可删除");
  if (!isSafeRelPath(rel)) throw new Error("路径非法");
  const file = path.join(pack.path, ...rel.split("/"));
  const writer = openIndexWriter(pack.path);
  try {
    const row = writer.prepare("SELECT path FROM memes WHERE path = ?").get(rel);
    if (!row) return false;
    writer.prepare("DELETE FROM memes WHERE path = ?").run(rel);
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* Windows 占用时保留文件，索引已删 */
    }
    return true;
  } finally {
    writer.close();
    invalidateStore(packId);
  }
}

export function setPackEnabled(packId: string, enabled: boolean): StickerSettings {
  const current = loadSettings();
  const ids = new Set(current.enabledPacks);
  if (enabled) ids.add(packId);
  else ids.delete(packId);
  return saveSettings({ enabledPacks: [...ids] });
}

export function setActivePack(packId: string): StickerSettings {
  if (!getPack(packId)) throw new Error("图库不存在");
  return saveSettings({ packId });
}

export function recentItems(): Array<Record<string, unknown>> {
  const data = safeJsonRead<{ recent?: Array<Record<string, unknown>> }>(recentPath(), { recent: [] });
  return Array.isArray(data.recent) ? data.recent : [];
}

export function addRecent(item: Record<string, unknown>): void {
  const current = recentItems();
  const key = String(item.path || "");
  const next = [item, ...current.filter((x) => String(x.path || "") !== key)].slice(0, 50);
  writeJsonAtomic(recentPath(), { recent: next });
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
