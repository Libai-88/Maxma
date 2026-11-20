/**
 * tools/stickers.ts — dsh-meme 工具面的 Maxma 适配。
 *
 * 移植 send_meme / learn_meme / meme_list / meme_update 的语义；
 * get_sticker 保留为旧分类别名，不再进提示词主路径。
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import type { MaxmaToolDescriptor } from "./descriptor";
import { maxmaBundleRoot, maxmaDataRoot } from "../kernel/project-paths";
import {
  ensurePackAt,
  MemesStore,
  MOODS,
  openIndexWriter,
  scanPacks,
} from "../../../bun-shared/dsh-meme/memes";
import { MOOD_DICT, normalizeSendMode, type PackMeta, resolveMood } from "../../../bun-shared/dsh-meme/memes";

const BUILTIN_PACK_ID = "maxma_builtin";
const USER_PACK_ID = "dsh-meme-user";
const MAX_IMAGE = 8 * 1024 * 1024;
const TAG_RE = /^[a-z0-9_-]{1,40}$/;
const IMAGE_EXTS = new Set([".webp", ".png", ".jpg", ".jpeg", ".gif"]);

/** 内置贴纸目录：<MAXMA_PROJECT_ROOT>/config/stickers/<category>/*.webp（旧兼容）。 */
export function stickersDir(): string {
  return path.join(maxmaBundleRoot(), "config", "stickers");
}

function packsDir(): string {
  return path.join(maxmaDataRoot(), "stickers", "packs");
}

function userPackDir(): string {
  return path.join(packsDir(), USER_PACK_ID);
}

function settingsPath(): string {
  return path.join(maxmaDataRoot(), "stickers", "settings.json");
}

function loadSettings(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function scanAllPacks(): PackMeta[] {
  return scanPacks(stickersDir(), packsDir()).map((pack) =>
    path.resolve(pack.path) === path.resolve(stickersDir())
      ? { ...pack, id: BUILTIN_PACK_ID }
      : pack,
  );
}

function enabledStores(): Array<{ pack: PackMeta; store: MemesStore }> {
  const packs = scanAllPacks();
  const settings = loadSettings();
  const enabled = Array.isArray(settings.enabledPacks)
    ? settings.enabledPacks.map(String)
    : packs.map((p) => p.id);
  const alive = new Set(packs.map((p) => p.id));
  const ids = enabled.filter((id) => alive.has(id));
  const selected = ids.length > 0 ? ids : [packs.find((p) => p.id === BUILTIN_PACK_ID)?.id].filter(Boolean) as string[];
  const out: Array<{ pack: PackMeta; store: MemesStore }> = [];
  for (const id of selected) {
    const pack = packs.find((p) => p.id === id);
    if (!pack) continue;
    try {
      out.push({ pack, store: new MemesStore(pack.path) });
    } catch {
      /* 坏库跳过 */
    }
  }
  return out;
}

function absolutePath(pack: PackMeta, rel: string): string {
  return path.join(pack.path, ...rel.split("/"));
}

function allRows(): Array<{ pack: PackMeta; row: Awaited<ReturnType<MemesStore["readRows"]>>[number] }> {
  return enabledStores().flatMap(({ pack, store }) =>
    store.rows.map((row) => ({ pack, row })),
  );
}

function tagStats(): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const { row } of allRows()) counts.set(row.tag, (counts.get(row.tag) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
}

function tagHint(): string {
  const stats = tagStats();
  if (stats.length > 0) {
    return `当前启用图库里的分类(按张数): ${stats.slice(0, 15).map((s) => `${s.tag}(${s.count})`).join(" / ")}`;
  }
  return `情绪字典: ${MOOD_DICT}`;
}

function clampLimit(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 8;
  return Math.max(1, Math.min(20, Math.floor(n)));
}

function captionOf(row: { caption?: string; file_name?: string }): string {
  return String(row.caption || row.file_name || "").slice(0, 80);
}

function lineFor(pack: PackMeta, row: { path: string; tag: string; caption?: string; file_name?: string }, index: number, textMode: boolean): string {
  const caption = captionOf(row);
  if (textMode) return `${index + 1}. 描述=${caption} | 分类=${row.tag}`;
  return `${index + 1}. [表情: ${caption}]`;
}

function detailFor(pack: PackMeta, row: { path: string; tag: string; caption?: string; file_name?: string }) {
  return {
    path: absolutePath(pack, row.path),
    pack: pack.id,
    library: pack.name,
    tag: row.tag,
    caption: captionOf(row),
  };
}

function sendToolResult(
  pack: PackMeta,
  row: { path: string; tag: string; caption?: string; file_name?: string },
  textMode: boolean,
) {
  return {
    ...detailFor(pack, row),
    ...(textMode ? {} : { marker: `[表情: ${captionOf(row)}]` }),
  };
}

/** 按分类随机取一个贴纸（旧 get_sticker 用，返回相对 config/stickers 的路径）。 */
export async function pickSticker(category: string): Promise<string | null> {
  const catDir = path.join(stickersDir(), category);
  let files: string[];
  try {
    files = fs.readdirSync(catDir);
  } catch {
    return null;
  }
  const images = files.filter((f) => /\.(webp|png|jpg|jpeg|gif)$/i.test(f));
  if (images.length === 0) return null;
  return `${category}/${images[Math.floor(Math.random() * images.length)]}`;
}

/** 列出所有贴纸分类及其贴纸数。 */
export async function listStickerCategories(): Promise<Array<{ category: string; count: number }>> {
  const dir = stickersDir();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const result: Array<{ category: string; count: number }> = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const files = fs.readdirSync(path.join(dir, e.name));
      const count = files.filter((f) => /\.(webp|png|jpg|jpeg|gif)$/i.test(f)).length;
      if (count > 0) result.push({ category: e.name, count });
    } catch {
      /* 忽略不可读分类 */
    }
  }
  return result.sort((a, b) => a.category.localeCompare(b.category));
}

const sendMemeSchema = {
  type: "object",
  properties: {
    tag: {
      type: "string",
      description: `情绪范围(可选): ${MOOD_DICT}。只给 tag = 在该情绪里随机抽;tag + query = 在该情绪里按关键词筛。`,
    },
    query: {
      type: "string",
      description:
        "关键词(可选): 按 caption/关键词/图名子串搜。中文词,空格分隔多个(如「猫」「生气 猫」「无语」);整词没命中会自动拆词重试。",
    },
    limit: { type: "number", description: "本次返回几张候选(1-20,默认 8)。" },
  },
  additionalProperties: false,
} as const;

export function sendMemeTool(): MaxmaToolDescriptor {
  return {
    name: "send_meme",
    label: "发表情",
    description:
      "发一张表情包。两种搜法:①只给 tag(情绪)→ 从该情绪里随机抽;②给 query(关键词)→ 在 caption/关键词/图名里搜。两个都给 = 在该情绪里按关键词筛。" +
      "流程:给 tag/query → 系统返回若干候选(带 caption) → 看描述觉得贴就发;不满意再 search 换一批。" +
      `情绪字典: ${MOOD_DICT}。Web 聊天把 [表情: 描述] 原样写进回复(描述抄候选原文,不要带路径;冒号用半角 :)。`,
    parameters: sendMemeSchema as unknown as MaxmaToolDescriptor["parameters"],
    approval: "read",
    async execute(_id, params) {
      const query = typeof params.query === "string" ? params.query.trim() : "";
      const tag = typeof params.tag === "string" ? params.tag.trim().toLowerCase() : "";
      const limit = clampLimit(params.limit);
      const sendMode = normalizeSendMode(loadSettings().sendMode);
      const textMode = sendMode === "text";
      const stores = enabledStores();
      if (stores.length === 0) {
        return {
          content: [{ type: "text", text: "当前没有启用的图库，先在后端表情设置里启用一个图库。" }],
          details: { ok: false, reason: "no-pack" },
        };
      }

      let candidates: Array<{ pack: PackMeta; row: { path: string; tag: string; caption?: string; file_name?: string } }> = [];
      if (query) {
        for (const { pack, store } of stores) {
          for (const row of store.search(query, limit, tag).memes) candidates.push({ pack, row });
        }
        if (candidates.length > 0) {
          const dedup = new Map<string, { pack: PackMeta; row: typeof candidates[number]["row"] }>();
          for (const c of candidates) dedup.set(`${c.pack.id}:${c.row.path}`, c);
          candidates = [...dedup.values()].slice(0, limit);
        }
      } else if (tag) {
        for (const { pack, store } of stores) {
          const mood = resolveMood(tag, null);
          if (!mood) continue;
          for (const row of store.sampleMood(mood, null, limit).memes) candidates.push({ pack, row });
        }
      } else {
        // 没关键词/情绪：给全库随机候选，便于模型先看有什么。
        const rows = allRows();
        const shuffled = rows.sort(() => Math.random() - 0.5).slice(0, limit);
        candidates = shuffled;
      }
      if (candidates.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `没有找到合适的表情。${query ? `关键词「${query}」没命中。` : ""}换一个更常见的词，或给一个情绪 tag。${tagHint()}`,
            },
          ],
          details: { ok: false, tags: tagStats() },
        };
      }
      const lines = candidates.map((c, i) => lineFor(c.pack, c.row, i, textMode)).join("\n");
      const how = textMode
        ? "发图:当前发送方式是「纯文字」，不发图片；把下面某行「描述=」原文用进文字回复里。"
        : "发图:把下面某一行的 [表情: ...] 整段原样写进回复(描述抄候选原文;冒号用半角 :)。候选 path 只是出处信息，不要贴进回复。";
      return {
        content: [
          {
            type: "text",
            text: `${query ? `关键词「${query}」命中 ${candidates.length} 张。` : `按情绪/全库取 ${candidates.length} 张。`}\n${how}\n${lines}`,
          },
        ],
        details: {
          ok: true,
          mode: query ? "keyword" : tag ? "mood" : "random",
          sendMode,
          tags: tagStats(),
          hits: candidates.map((c) => sendToolResult(c.pack, c.row, textMode)),
        },
      };
    },
  };
}

const memeListSchema = {
  type: "object",
  properties: {
    q: { type: "string", description: "关键词（caption/关键词/文件名子串）" },
    tag: { type: "string", description: "分类/情绪 tag" },
    packId: { type: "string", description: "图库 id；不传则查全部启用图库" },
    limit: { type: "number", description: "返回上限 1-50，默认 20" },
  },
  additionalProperties: false,
} as const;

export function memeListTool(): MaxmaToolDescriptor {
  return {
    name: "meme_list",
    label: "表情清单",
    description: "只读列出图库里的表情：分类、描述、关键词、磁盘绝对路径。用于确认图库内容或挑选已有图。",
    parameters: memeListSchema as unknown as MaxmaToolDescriptor["parameters"],
    approval: "read",
    async execute(_id, params) {
      const q = typeof params.q === "string" ? params.q.trim() : "";
      const tag = typeof params.tag === "string" ? params.tag.trim().toLowerCase() : "";
      const packId = typeof params.packId === "string" ? params.packId.trim() : "";
      const limit = Math.max(1, Math.min(50, Number(params.limit) || 20));
      const packs = scanAllPacks().filter((p) => !packId || p.id === packId);
      const out: Array<Record<string, unknown>> = [];
      for (const pack of packs) {
        let store: MemesStore;
        try {
          store = new MemesStore(pack.path);
        } catch {
          continue;
        }
        let rows = store.rows;
        if (tag) {
          const mood = resolveMood(tag, null);
          rows = rows.filter((r) => (mood ? (MOODS[mood] as readonly string[]).includes(r.tag) : r.tag === tag));
        }
        if (q) {
          const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
          rows = rows.filter((r) =>
            tokens.some((t) => `${r.tag} ${r.caption} ${r.keywords} ${r.file_name}`.toLowerCase().includes(t)),
          );
        }
        for (const row of rows.slice(0, limit)) {
          out.push({ pack: pack.id, library: pack.name, tag: row.tag, caption: captionOf(row), keywords: row.keywords, path: absolutePath(pack, row.path) });
        }
      }
      if (out.length === 0) {
        return {
          content: [{ type: "text", text: "没有匹配的表情；可先不传 q/tag 查看当前图库。" }],
          details: { ok: false, total: 0 },
        };
      }
      return {
        content: [
          {
            type: "text",
            text: out
              .map((r, i) => `${i + 1}. [${r.tag}] ${r.caption} | ${r.library} | ${r.path}`)
              .join("\n"),
          },
        ],
        details: { ok: true, total: out.length, memes: out },
      };
    },
  };
}

const memeUpdateSchema = {
  type: "object",
  properties: {
    path: { type: "string", description: "图片绝对路径（来自 meme_list/send_meme 候选）" },
    tag: { type: "string", description: "新分类 tag（小写英文/数字/-/_）" },
    caption: { type: "string", description: "新描述（≤200 字）" },
    keywords: { type: "string", description: "新关键词（空格分隔，≤200 字）" },
  },
  required: ["path"],
  additionalProperties: false,
} as const;

function packForAbsolute(file: string): { pack: PackMeta; rel: string } | null {
  const abs = path.resolve(file);
  for (const pack of scanAllPacks()) {
    const root = path.resolve(pack.path);
    if (abs === root || abs.startsWith(root + path.sep)) {
      return { pack, rel: abs.slice(root.length + 1).replace(/\\/g, "/") };
    }
  }
  return null;
}

export function memeUpdateTool(): MaxmaToolDescriptor {
  return {
    name: "meme_update",
    label: "修改表情信息",
    description: "修改表情的分类/描述/关键词；只改 index.db，不动图片。至少提供 tag/caption/keywords 之一。",
    parameters: memeUpdateSchema as unknown as MaxmaToolDescriptor["parameters"],
    approval: "write",
    async execute(_id, params) {
      const file = typeof params.path === "string" ? params.path.trim() : "";
      if (!file) return { content: [{ type: "text", text: "缺少 path" }], details: { ok: false } };
      const found = packForAbsolute(file);
      if (!found) return { content: [{ type: "text", text: "路径不在任何图库内" }], details: { ok: false } };
      if (found.pack.source === "bundled") {
        return { content: [{ type: "text", text: "内置图库不可编辑；请复制到我的收藏图库后再改" }], details: { ok: false } };
      }
      const patch: Record<string, string> = {};
      for (const key of ["tag", "caption", "keywords"] as const) {
        if (typeof params[key] === "string") patch[key] = String(params[key]);
      }
      if (Object.keys(patch).length === 0) {
        return { content: [{ type: "text", text: "至少提供 tag/caption/keywords 之一" }], details: { ok: false } };
      }
      if (patch.tag !== undefined && !TAG_RE.test(patch.tag)) {
        return { content: [{ type: "text", text: "非法 tag：只允许小写英文/数字/-/_" }], details: { ok: false } };
      }
      const writer = openIndexWriter(found.pack.path, { packageDir: stickersDir() });
      try {
        const row = writer.prepare("SELECT path FROM memes WHERE path = ?").get(found.rel);
        if (!row) return { content: [{ type: "text", text: "索引里没有这张图" }], details: { ok: false } };
        for (const [key, value] of Object.entries(patch)) {
          writer.prepare(`UPDATE memes SET ${key} = ? WHERE path = ?`).run(value.slice(0, 200), found.rel);
        }
        return { content: [{ type: "text", text: `已更新 ${found.rel}` }], details: { ok: true, path: found.rel } };
      } finally {
        writer.close();
      }
    },
  };
}

function sniffImageExt(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf.length >= 6 && buf.subarray(0, 6).toString("ascii") === "GIF87a") return ".gif";
  if (buf.length >= 6 && buf.subarray(0, 6).toString("ascii") === "GIF89a") return ".gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return ".webp";
  return null;
}

async function imageBytesFrom(params: Record<string, unknown>): Promise<{ buf: Buffer; name: string }> {
  const imageUrl = typeof params.imageUrl === "string" ? params.imageUrl.trim() : "";
  const sourcePath = typeof params.sourcePath === "string" ? params.sourcePath.trim() : "";
  const attachmentId = typeof params.attachmentId === "string" ? params.attachmentId.trim() : "";

  if (sourcePath) {
    if (!path.isAbsolute(sourcePath)) throw new Error("sourcePath 必须是绝对路径");
    const buf = fs.readFileSync(sourcePath);
    return { buf, name: path.basename(sourcePath) };
  }
  if (attachmentId) {
    const uploads = path.join(maxmaDataRoot(), "uploads");
    let names: string[] = [];
    try {
      names = fs.readdirSync(uploads);
    } catch {
      /* no uploads */
    }
    const hit = names.find((n) => n.includes(attachmentId));
    if (!hit) throw new Error("找不到对应附件");
    return { buf: fs.readFileSync(path.join(uploads, hit)), name: hit };
  }
  if (imageUrl) {
    if (!/^https?:\/\//i.test(imageUrl)) throw new Error("imageUrl 必须是 http(s)");
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000), redirect: "follow" });
    if (!res.ok) throw new Error(`下载失败: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { buf, name: path.basename(new URL(imageUrl).pathname) || "sticker.img" };
  }
  throw new Error("需要 attachmentId/imageUrl/sourcePath 之一");
}

const learnMemeSchema = {
  type: "object",
  properties: {
    attachmentId: { type: "string", description: "当前会话附件 id/文件名片段" },
    imageUrl: { type: "string", description: "http(s) 图片直链（≤8MB）" },
    sourcePath: { type: "string", description: "本地图片绝对路径（仅受信任调用）" },
    tag: { type: "string", description: "分类 tag；不传则 daily，并提示手动分类" },
    caption: { type: "string", description: "描述；不传用文件名" },
    keywords: { type: "string", description: "关键词；不传用 tag" },
  },
  additionalProperties: false,
} as const;

export function learnMemeTool(): MaxmaToolDescriptor {
  return {
    name: "learn_meme",
    label: "收录表情",
    description:
      "把用户附件或图片 URL 收录到「我的收藏」图库(dsh-meme-user)。保存原始字节（GIF 不被压帧）；语义描述由调用方通过 caption/keywords 提供，未提供时按 tag/文件名分类，不偷偷调用未配置的视觉模型。",
    parameters: learnMemeSchema as unknown as MaxmaToolDescriptor["parameters"],
    approval: "write",
    async execute(_id, params) {
      let buf: Buffer;
      let name: string;
      try {
        const got = await imageBytesFrom(params);
        buf = got.buf;
        name = got.name;
      } catch (err) {
        return { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], details: { ok: false } };
      }
      if (buf.length > MAX_IMAGE) {
        return { content: [{ type: "text", text: `图片超过 ${MAX_IMAGE / 1024 / 1024}MB，未收录` }], details: { ok: false } };
      }
      const ext = sniffImageExt(buf);
      if (!ext) {
        return { content: [{ type: "text", text: "不是可识别的 jpg/png/gif/webp 图片，未收录" }], details: { ok: false } };
      }
      const rawTag = typeof params.tag === "string" ? params.tag.trim().toLowerCase() : "";
      const tag = TAG_RE.test(rawTag) ? rawTag : "daily";
      const caption = String(params.caption || path.basename(name, path.extname(name))).slice(0, 200);
      const keywords = String(params.keywords || tag).slice(0, 200);
      ensurePackAt(userPackDir(), { id: USER_PACK_ID, name: "我的收藏" });
      const hash = crypto.createHash("md5").update(buf).digest("hex").slice(0, 16);
      const filename = `sticker_${hash}${ext}`;
      const rel = `memes/${tag}/${filename}`;
      const dst = path.join(userPackDir(), ...rel.split("/"));
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      if (!fs.existsSync(dst)) fs.writeFileSync(dst, buf);
      const writer = openIndexWriter(userPackDir());
      try {
        const exists = writer.prepare("SELECT path FROM memes WHERE path = ?").get(rel);
        if (!exists) {
          writer
            .prepare(
              "INSERT OR REPLACE INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            )
            .run(rel, tag, filename, caption, keywords, Date.now(), null);
        }
      } finally {
        writer.close();
      }
      const hint = !rawTag ? "（没给 tag，按 daily 收录；可用 meme_update 改分类）" : "";
      return {
        content: [{ type: "text", text: `已收录到「我的收藏」：${caption}（${tag}）${hint}` }],
        details: { ok: true, pack: USER_PACK_ID, path: rel, tag, caption, keywords },
      };
    },
  };
}

/** 旧工具：保留 get_sticker 名字与 category 语义，内部仍走旧内置目录。 */
export function getStickerTool(): MaxmaToolDescriptor {
  return {
    name: "get_sticker",
    label: "取贴纸（兼容）",
    description:
      "兼容旧会话：不传 category 时返回可用分类；传入分类名时随机返回该分类下的一张贴纸路径。新提示词请优先使用 send_meme。",
    parameters: {
      type: "object",
      properties: {
        category: { type: "string", description: "贴纸分类名（如 开心/委屈/害羞）" },
      },
      additionalProperties: false,
    } as unknown as MaxmaToolDescriptor["parameters"],
    approval: "read",
    async execute(_id, params) {
      const category = (typeof params.category === "string" ? params.category : "").trim();
      if (!category) {
        const cats = await listStickerCategories();
        return {
          content: [{ type: "text", text: cats.length ? cats.map((c) => `- ${c.category}（${c.count} 张）`).join("\n") : "当前没有可用的贴纸。" }],
          details: { categories: cats },
        };
      }
      const stickerPath = await pickSticker(category);
      if (!stickerPath) {
        return { content: [{ type: "text", text: `分类「${category}」下没有贴纸。` }], details: { found: false } };
      }
      return { content: [{ type: "text", text: `贴纸：${stickerPath}` }], details: { found: true, path: stickerPath } };
    },
  };
}
