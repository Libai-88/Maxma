/**
 * dsh-meme 表情图库核心（Maxma vendored port）。
 *
 * 来源：https://github.com/yyh-001/dsh-meme
 * 版本：0.1.85（MIT）
 * 本文件保留上游的 pack/index/search 语义，只做两处宿主适配：
 *   1. node:sqlite 的 DatabaseSync -> bun:sqlite 的 Database；
 *   2. 去掉 DSH defineTool / IM 投递，工具层在 bun-sidecar 中另行适配。
 *
 * 上游版权：Copyright (c) 2026 Selfloom contributors，MIT License。
 */
import { Database } from "bun:sqlite";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

export type PackSource = "bundled" | "user" | "custom";

export interface PackMeta {
  id: string;
  name: string;
  description: string;
  version: string;
  count: number;
  cover: string;
  size: number;
  path: string;
  source: PackSource;
}

export interface MemeRow {
  path: string;
  tag: string;
  file_name: string;
  caption: string;
  keywords: string;
}

export interface MemeHit extends MemeRow {
  packId?: string;
  packName?: string;
}

export interface PackSettings {
  packId?: string;
  packsDir?: string;
  memeRoot?: string;
  enabledPacks?: string[];
  [key: string]: unknown;
}

/** 打开只读 SQLite。Bun 的选项名是 readonly（不是 node:sqlite 的 readOnly）。 */
function openReadonly(indexPath: string): Database {
  return new Database(indexPath, { readonly: true });
}

function openWritable(indexPath: string): Database {
  return new Database(indexPath);
}

export function isPackDir(dir: string): boolean {
  try {
    return statSync(dir).isDirectory() && existsSync(join(dir, "index.db"));
  } catch {
    return false;
  }
}

/** 读 manifest + 张数。id 以文件夹名为准（切换键稳定）。 */
export function readPackMeta(
  dir: string,
  id: string = basename(dir),
  source: PackSource = "custom",
): PackMeta {
  let name = id;
  let description = "";
  let version = "";
  try {
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
      name?: string;
      description?: string;
      version?: string;
    };
    if (m?.name) name = String(m.name);
    if (m?.description) description = String(m.description);
    if (m?.version) version = String(m.version);
  } catch {
    /* 无 manifest 也能当包用 */
  }
  let count = 0;
  let cover = "";
  try {
    const db = openReadonly(join(dir, "index.db"));
    try {
      const n = db.prepare("SELECT COUNT(*) AS n FROM memes").get() as { n?: number } | null;
      count = Number(n?.n) || 0;
      const row = db
        .prepare("SELECT path FROM memes ORDER BY (tag = 'happy') DESC, path ASC LIMIT 1")
        .get() as { path?: string } | null;
      if (row?.path) cover = String(row.path);
    } finally {
      try {
        db.close();
      } catch {
        /* 已关闭 */
      }
    }
  } catch {
    /* 空库或坏库 */
  }
  return {
    id,
    name,
    description,
    version,
    count,
    cover,
    size: packSizeBytes(dir),
    path: resolve(dir),
    source,
  };
}

const packSizeCache = new Map<string, { bytes: number; checkedAt: number; mtimeMs: number }>();

/** 图库总大小（只算图片文件，不含 index.db/manifest）。 */
export function packSizeBytes(dir: string): number {
  const abs = resolve(dir);
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(abs).mtimeMs;
  } catch {
    return 0;
  }
  const now = Date.now();
  const hit = packSizeCache.get(abs);
  if (hit && hit.mtimeMs === mtimeMs && now - hit.checkedAt < 60_000) return hit.bytes;
  let bytes = 0;
  for (const rel of walkPackImages(abs)) {
    try {
      bytes += statSync(join(abs, rel)).size;
    } catch {
      /* 文件刚被删/被占用 */
    }
  }
  packSizeCache.set(abs, { bytes, checkedAt: now, mtimeMs });
  return bytes;
}

/**
 * 扫描可切换图库：内置目录 + 用户目录。
 * 同 id 时用户目录覆盖内置（方便自己改官方包），同层里顶层优先。
 * 兼容历史遗留嵌套：扫描目录本身是包、包目录下再嵌一层包。
 */
export function scanPacks(bundledDir: string, packsDir: string): PackMeta[] {
  const byId = new Map<string, PackMeta>();
  const addPack = (dir: string, id: string, source: PackSource) => {
    if (!id || byId.has(id)) return;
    byId.set(id, readPackMeta(dir, id, source));
  };
  const addFrom = (parent: string, source: PackSource) => {
    if (!parent || !existsSync(parent)) return;
    if (isPackDir(parent)) addPack(parent, basename(parent), source);
    let names: string[];
    try {
      names = readdirSync(parent);
    } catch {
      return;
    }
    for (const name of names) {
      const dir = join(parent, name);
      if (!isPackDir(dir)) continue;
      addPack(dir, name, source);
      let subs: string[];
      try {
        subs = readdirSync(dir);
      } catch {
        continue;
      }
      for (const sub of subs) {
        const subdir = join(dir, sub);
        if (!isPackDir(subdir)) continue;
        addPack(subdir, sub, source);
      }
    }
  };
  addFrom(bundledDir, "bundled");
  addFrom(packsDir, "user");
  return [...byId.values()];
}

/**
 * 删除图库时该删哪个目录。只认两种路径，别的一律拒绝（防越界/防误删）：
 * - 内置包：bundledDir/<id>
 * - 用户包：packsDir 子树里一个真正的包目录
 */
export function packDeleteDir(pack: PackMeta, packsDir: string, bundledDir: string): string {
  const id = String(pack?.id || "").trim();
  if (!pack?.path || !id) throw new Error("图库信息不完整");
  const dir = resolve(pack.path);
  if (pack.source === "bundled") {
    if (dir !== resolve(join(bundledDir, id))) throw new Error("图库目录与预期不符，已拒绝删除");
    return dir;
  }
  const root = resolve(String(packsDir || ""));
  if (!root) throw new Error("图库目录无效，已拒绝删除");
  if (dir === root) throw new Error("这个图库就是当前的「图库目录」本身，请先把它改到上级目录再删");
  if (basename(dir) === id && dir.startsWith(root + sep)) return dir;
  throw new Error("图库目录与预期不符，已拒绝删除");
}

/** 模型可用的图库 id 列表。没设置过 enabledPacks 时只算当前图库。 */
export function enabledPackIds(
  settings: PackSettings = {},
  packs: PackMeta[] = [],
  activeId = "",
): string[] {
  const saved = Array.isArray(settings.enabledPacks)
    ? settings.enabledPacks.map(String)
    : null;
  if (saved === null) return activeId ? [activeId] : [];
  const alive = new Set(packs.map((p) => p.id));
  return saved.filter((id) => alive.has(id));
}

/** 设置 packId > memeRoot > configRoot > fallbackRoot。 */
export function resolveActiveRoot(
  settings: PackSettings,
  packs: PackMeta[],
  configRoot?: string,
  fallbackRoot?: string,
): string {
  const packId = String(settings.packId || "").trim();
  if (packId && packId !== "_custom") {
    const hit = packs.find((p) => p.id === packId);
    if (hit) return hit.path;
  }
  if (settings.memeRoot && isPackDir(String(settings.memeRoot))) {
    return resolve(String(settings.memeRoot));
  }
  if (configRoot && isPackDir(configRoot)) return resolve(configRoot);
  if (fallbackRoot && isPackDir(fallbackRoot)) return resolve(fallbackRoot);
  throw new Error("没有可用的表情图库");
}

/** 热切换时工具闭包仍指向同一对象：replace 内部 store。 */
export function liveStore(store: MemesStore) {
  const box = {
    get root(): string {
      return box._s.root;
    },
    list(...a: Parameters<MemesStore["list"]>) {
      return box._s.list(...a);
    },
    search(...a: Parameters<MemesStore["search"]>) {
      return box._s.search(...a);
    },
    sampleMood(...a: Parameters<MemesStore["sampleMood"]>) {
      return box._s.sampleMood(...a);
    },
    resolveStored(...a: Parameters<MemesStore["resolveStored"]>) {
      return box._s.resolveStored(...a);
    },
    refresh() {
      box._s.refresh();
    },
    replace(next: MemesStore) {
      const prev = box._s;
      box._s = next;
      if (prev && prev !== next) prev.close();
    },
    _s: store,
  };
  return box;
}

/** 模型只认这 6 个情绪桶；磁盘上仍是细 tag（路径不改）。 */
export const MOODS = {
  happy: ["happy", "like", "meow", "givemoney", "color"],
  angry: ["angry", "fool", "baka"],
  sad: ["sad", "sigh"],
  shy: ["shy"],
  confused: ["confused", "surprised", "see"],
  daily: ["daily", "sleep", "morning", "work", "cpu", "reply"],
} as const;

export type MoodName = keyof typeof MOODS;

const MOOD_WORDS: Record<MoodName, string> = {
  happy: "开心 高兴 兴奋 喜欢 卖萌 可爱 比心 哈哈 欢迎 得意 好耶 满意",
  angry: "生气 愤怒 暴躁 笨蛋 傻瓜 嫌弃 逮",
  sad: "难过 哭 委屈 叹气 无语 求饶 怂 晕",
  shy: "害羞 腼腆 脸红 花痴",
  confused: "困惑 疑惑 惊讶 问号 懵 惊吓 震惊",
  daily: "困 睡觉 早上好 打招呼 你好 上班 下班 摸鱼 工作 熬夜 吃饭 干饭 饿 日常",
};

export const MOOD_DICT =
  "happy 开心(卖萌/可爱/喜欢) / angry 生气 / sad 难过(无语/求饶) / shy 害羞 / confused 困惑惊讶 / daily 日常(睡觉/上班/早上好)";

export function moodNames(): MoodName[] {
  return Object.keys(MOODS) as MoodName[];
}

/**
 * Maxma 旧分类是中文；dsh-meme 的六桶是英文。这里给旧 prompt / 旧 URL 一个
 * 只读别名层，不改变磁盘 tag，也不把中文写进 index.db。
 */
const TAG_ALIASES: Record<string, MoodName> = {
  开心: "happy",
  高兴: "happy",
  得意: "happy",
  爱心: "happy",
  撒娇: "happy",
  生气: "angry",
  委屈: "sad",
  悲伤: "sad",
  难过: "sad",
  无语: "sad",
  害羞: "shy",
  惊讶: "confused",
  尴尬: "confused",
  困惑: "confused",
  日常: "daily",
};

/** 旧中文分类 -> dsh-meme 六桶；未知分类归 daily（不丢图，仍可用真实 tag 搜）。 */
export function legacyTagForCategory(category: string): MoodName {
  return TAG_ALIASES[String(category || "").trim()] || "daily";
}

function canonicalTag(tag?: string | null): string {
  const t = String(tag || "").trim().toLowerCase();
  if (!t) return "";
  return TAG_ALIASES[t] || t;
}

export function fineTagsFor(tag?: string | null): readonly string[] | null {
  const t = canonicalTag(tag);
  if (!t) return null;
  const groups = MOODS as Record<string, readonly string[]>;
  if (groups[t]) return groups[t]!;
  for (const fine of Object.values(groups)) {
    if (fine.includes(t)) return [t];
  }
  return [t];
}

function moodsFromQuery(text: string): MoodName[] {
  const hit: MoodName[] = [];
  for (const [mood, words] of Object.entries(MOOD_WORDS) as [MoodName, string][]) {
    if (words.split(/\s+/).some((w) => w && text.includes(w))) hit.push(mood);
  }
  return hit;
}

/** tag 优先；否则用 query 里的口语词推断情绪。 */
export function resolveMood(tag?: string | null, query?: string | null): MoodName | null {
  const t = canonicalTag(tag);
  if (t) {
    if ((MOODS as Record<string, readonly string[]>)[t]) return t as MoodName;
    for (const [mood, fine] of Object.entries(MOODS) as [MoodName, readonly string[]][]) {
      if (fine.includes(t)) return mood;
    }
  }
  const q = String(query || "").trim().toLowerCase();
  if (!q) return null;
  if ((MOODS as Record<string, readonly string[]>)[q]) return q as MoodName;
  return moodsFromQuery(q)[0] || null;
}

function pickRandom<T>(rows: T[], n: number): T[] {
  const copy = rows.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy.slice(0, n);
}

/** 关键词分词：空格/逗号/顿号/斜杠分隔，小写去重。中文词整词先搜，不预先切。 */
export function keywordTokens(query: string): string[] {
  const raw = String(query || "").trim().toLowerCase();
  if (!raw) return [];
  return [...new Set(raw.split(/[\s,，、;；/|]+/).filter(Boolean))];
}

/** 整词全都没命中时的兜底拆词：「生气猫」→ 生气 / 气猫。 */
function biGrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    if (t.length < 3 || !/[\u4e00-\u9fff]/.test(t)) continue;
    for (let i = 0; i + 2 <= t.length; i++) out.push(t.slice(i, i + 2));
  }
  return [...new Set(out)];
}

const keywordWords = (s?: string) => String(s || "").split(/[\s,，、;；/|]+/).filter(Boolean);

export function pruneCommonKeywords(
  rows: Array<{ keywords?: string }>,
  { threshold = 0.5, minRows = 8 } = {},
): { total: number; drop: string[]; cleaned: Array<string | null> } {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length;
  const none = list.map(() => null);
  if (total < minRows) return { total, drop: [], cleaned: none };
  const words = list.map((row) => keywordWords(row?.keywords));
  const counts = new Map<string, number>();
  for (const toks of words) {
    for (const w of new Set(toks.map((t) => t.toLowerCase()))) {
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  const floor = Math.max(2, Math.ceil(total * threshold));
  const drop = [...counts].filter(([, n]) => n >= floor).map(([w]) => w);
  if (drop.length === 0) return { total, drop: [], cleaned: none };
  const dropSet = new Set(drop);
  return {
    total,
    drop,
    cleaned: words.map((toks) => {
      const keep = toks.filter((w) => !dropSet.has(w.toLowerCase()));
      return keep.length === toks.length ? null : keep.join(" ");
    }),
  };
}

/** 对已落盘的图库做一次高频关键词清洗（导入/安装流程调用）。 */
export function prunePackKeywords(
  indexPath: string,
  opts?: { threshold?: number; minRows?: number },
): { drop: string[]; changed: number } {
  const db = openWritable(indexPath);
  try {
    const rows = db
      .prepare("SELECT rowid AS rid, COALESCE(keywords, '') AS keywords FROM memes")
      .all() as Array<{ rid: number; keywords: string }>;
    const { drop, cleaned } = pruneCommonKeywords(rows, opts);
    if (drop.length === 0) return { drop: [], changed: 0 };
    let changed = 0;
    const update = db.prepare("UPDATE memes SET keywords = ? WHERE rowid = ?");
    for (let i = 0; i < rows.length; i++) {
      const value = cleaned[i];
      if (value == null) continue;
      update.run(value, rows[i]!.rid);
      changed++;
    }
    return { drop, changed };
  } finally {
    try {
      db.close();
    } catch {
      /* 已关闭 */
    }
  }
}

const rowHay = (row: MemeRow) =>
  `${row.tag || ""} ${row.caption || ""} ${row.keywords || ""} ${row.file_name || ""}`.toLowerCase();

/** 关键词搜图（纯函数：面板/工具/跨图库合并共用）。 */
export function searchRows(
  rows: MemeRow[],
  query: string,
  limit = 8,
): { query: string; tokens: string[]; memes: MemeRow[] } {
  const tokens = keywordTokens(query);
  if (tokens.length === 0) return { query: "", tokens: [], memes: [] };
  const scan = (words: string[]) => {
    const hits: Array<{ row: MemeRow; score: number }> = [];
    for (const row of rows) {
      const hay = rowHay(row);
      let score = 0;
      for (const w of words) if (hay.includes(w)) score++;
      if (score > 0) hits.push({ row, score });
    }
    return hits;
  };
  let hits = scan(tokens);
  if (hits.length === 0) {
    const grams = biGrams(tokens);
    if (grams.length) hits = scan(grams);
  }
  if (hits.length === 0) return { query: tokens.join(" "), tokens, memes: [] };
  const best = Math.max(...hits.map((h) => h.score));
  return {
    query: tokens.join(" "),
    tokens,
    memes: pickRandom(
      hits.filter((h) => h.score === best).map((h) => h.row),
      limit,
    ),
  };
}

const SELECT_ROWS =
  "SELECT path, tag, file_name, caption, COALESCE(keywords, '') AS keywords FROM memes";

/** 图库索引（只读检索）。构造时一次读全表并关连接，运行期不占图库文件。 */
export class MemesStore {
  root: string;
  rows: MemeRow[];

  constructor(root: string) {
    this.root = resolve(root);
    if (!existsSync(join(this.root, "index.db"))) {
      throw new Error(`缺少表情包索引: ${join(this.root, "index.db")}`);
    }
    this.rows = this.readRows();
  }

  readRows(): MemeRow[] {
    const db = openReadonly(join(this.root, "index.db"));
    try {
      return db.prepare(SELECT_ROWS).all() as MemeRow[];
    } finally {
      try {
        db.close();
      } catch {
        /* 已关闭 */
      }
    }
  }

  refresh(): void {
    this.rows = this.readRows();
  }

  list(
    tag?: string | null,
    query?: string | null,
    exact = false,
  ): { memes: MemeRow[]; tags: MoodName[] } {
    let memes = this.rows;
    if (exact && tag) {
      memes = memes.filter((m) => m.tag === String(tag).trim().toLowerCase());
    } else {
      const fine = fineTagsFor(tag);
      if (fine) memes = memes.filter((m) => fine.includes(m.tag));
    }
    const q = query && String(query).trim().toLowerCase();
    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean);
      memes = memes.filter((m) => {
        const hay = `${m.tag} ${m.caption ?? ""} ${m.keywords ?? ""}`.toLowerCase();
        return tokens.some((t) => hay.includes(t));
      });
    }
    return { memes, tags: moodNames() };
  }

  search(
    query: string,
    n = 8,
    tag?: string | null,
  ): { query: string; tokens: string[]; memes: MemeRow[]; tags: MoodName[] } {
    const fine = fineTagsFor(tag);
    const scoped = fine ? this.rows.filter((m) => fine.includes(m.tag)) : this.rows;
    return { ...searchRows(scoped, query, n), tags: moodNames() };
  }

  sampleMood(
    tag?: string | null,
    query?: string | null,
    n = 5,
  ): { mood: MoodName | null; memes: MemeRow[]; tags: MoodName[] } {
    const mood = resolveMood(tag, query);
    if (!mood) return { mood: null, memes: [], tags: moodNames() };
    const { memes } = this.list(mood);
    return { mood, memes: pickRandom(memes, n), tags: moodNames() };
  }

  /** 把索引内相对路径或绝对路径解析为绝对路径（不允许逃出图库根）。 */
  resolveStored(stored: string): string {
    const raw = String(stored || "");
    const target = isAbsolute(raw) ? resolve(raw) : resolve(this.root, raw);
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error("路径超出表情包目录");
    }
    if (!existsSync(target)) throw new Error(`文件不存在: ${stored}`);
    return target;
  }

  close(): void {
    /* 连接已在构造/刷新时关闭 */
  }
}

/**
 * 图库索引的可写连接。
 * 内置图库（在 bundle 根内）每条语句临时 open→执行→close，避免 Windows 更新时
 * rename 目录报 EPERM/EBUSY；用户图库保持短连接（Maxma 删除前会显式 close）。
 */
export function openIndexWriter(
  root: string,
  opts: { packageDir?: string } = {},
) {
  const dir = resolve(root);
  const indexPath = join(dir, "index.db");
  const packageDir = opts.packageDir ? resolve(opts.packageDir) : null;
  const insidePackage =
    !!packageDir && (dir === packageDir || dir.startsWith(packageDir + sep));

  if (!insidePackage) {
    const db = openWritable(indexPath);
    return {
      prepare: (sql: string) => db.prepare(sql),
      exec: (sql: string) => db.exec(sql),
      close: () => {
        try {
          db.close();
        } catch {
          /* 已关闭 */
        }
      },
    };
  }

  const withDb = <T>(fn: (db: Database) => T): T => {
    const db = openWritable(indexPath);
    try {
      return fn(db);
    } finally {
      try {
        db.close();
      } catch {
        /* 已关闭 */
      }
    }
  };
  const statement = (sql: string) => ({
    run: (...args: unknown[]) => withDb((db) => db.prepare(sql).run(...(args as never[]))),
    get: (...args: unknown[]) => withDb((db) => db.prepare(sql).get(...(args as never[]))),
    all: (...args: unknown[]) => withDb((db) => db.prepare(sql).all(...(args as never[]))),
  });
  return {
    prepare: statement,
    exec: (sql: string) => withDb((db) => db.exec(sql)),
    close: () => {
      /* 无常驻连接 */
    },
  };
}

// ---- 用户收藏的稳定落点与图库目录扫描 ----

/** 扫描/收录认可的图片扩展（与上传、AI 学图一致） */
export const SCAN_IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

const SCAN_TAG_RE = /^[a-z0-9_-]+$/;

/** 手动放进图库目录的图片 → 索引行。 */
export function scanRowFor(rel: string): {
  path: string;
  tag: string;
  file_name: string;
  caption: string;
} {
  const posix = String(rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const body = posix.startsWith("memes/") ? posix.slice("memes/".length) : posix;
  const segs = body.split("/").filter(Boolean);
  const file = segs[segs.length - 1] || "";
  const tag = segs.length >= 2 && SCAN_TAG_RE.test(segs[0]!) ? segs[0]! : "misc";
  const dot = file.lastIndexOf(".");
  const stem = dot > 0 ? file.slice(0, dot) : file;
  return { path: posix, tag, file_name: file, caption: stem.slice(0, 200) };
}

/** 递归列出图库目录下的图片文件（相对 root 的 posix 路径）。 */
export function walkPackImages(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    let entries: Array<import("node:fs").Dirent> = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (
        e.name.startsWith(".") ||
        e.name === "manifest.json" ||
        e.name.startsWith("index.db")
      )
        continue;
      const abs = join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      if (!e.isFile()) continue;
      const dot = e.name.lastIndexOf(".");
      const ext = dot >= 0 ? e.name.slice(dot).toLowerCase() : "";
      if (SCAN_IMAGE_EXTS.includes(ext)) out.push(rel);
    }
  };
  walk(resolve(root), "");
  return out.sort();
}

/** 确保一个最小图库存在于 dir（manifest.json + 空 index.db），已存在则不动。 */
export function ensurePackAt(
  dir: string,
  meta: { id: string; name: string; description?: string },
): string {
  mkdirSync(dir, { recursive: true });
  const indexPath = join(dir, "index.db");
  if (!existsSync(indexPath)) {
    const db = openWritable(indexPath);
    try {
      db.exec(
        "CREATE TABLE IF NOT EXISTS memes (path TEXT PRIMARY KEY, tag TEXT, file_name TEXT, caption TEXT, keywords TEXT, mtime REAL, captioned_at REAL)",
      );
    } finally {
      try {
        db.close();
      } catch {
        /* 已关闭 */
      }
    }
  }
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) {
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          id: meta.id,
          name: meta.name,
          description: String(meta.description || ""),
          version: "1.0.0",
        },
        null,
        2,
      ),
    );
  }
  return dir;
}

/** 把 src 图库里的指定条目搬到 dst 图库的 memes/<tag>/ 下。 */
export function movePackEntries(
  srcRoot: string,
  dstRoot: string,
  paths: string[],
): { moved: Array<{ from: string; to: string }>; missing: string[] } {
  const moved: Array<{ from: string; to: string }> = [];
  const missing: string[] = [];
  const src = openIndexWriter(srcRoot);
  const dst = openIndexWriter(dstRoot);
  try {
    for (const rel of paths || []) {
      const row = src
        .prepare("SELECT tag, file_name, caption, keywords FROM memes WHERE path = ?")
        .get(String(rel)) as
        | { tag?: string; file_name?: string; caption?: string; keywords?: string }
        | null;
      const from = join(resolve(srcRoot), String(rel));
      if (!row || !existsSync(from)) {
        missing.push(String(rel));
        continue;
      }
      const tag = SCAN_TAG_RE.test(String(row.tag || "")) ? String(row.tag) : "misc";
      let name = basename(String(rel));
      let toRel = `memes/${tag}/${name}`;
      if (existsSync(join(resolve(dstRoot), toRel))) {
        const dot = name.lastIndexOf(".");
        name = `${dot > 0 ? name.slice(0, dot) : name}_${Date.now()}${dot > 0 ? name.slice(dot) : ""}`;
        toRel = `memes/${tag}/${name}`;
      }
      const to = join(resolve(dstRoot), toRel);
      mkdirSync(dirname(to), { recursive: true });
      try {
        renameSync(from, to);
      } catch {
        copyFileSync(from, to);
        unlinkSync(from);
      }
      dst
        .prepare(
          "INSERT OR REPLACE INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(toRel, tag, name, row.caption || "", row.keywords || "", Date.now(), Date.now());
      src.prepare("DELETE FROM memes WHERE path = ?").run(String(rel));
      moved.push({ from: String(rel), to: toRel });
    }
  } finally {
    try {
      src.close();
    } catch {
      /* 已关闭 */
    }
    try {
      dst.close();
    } catch {
      /* 已关闭 */
    }
  }
  return { moved, missing };
}

// ---- 设置枚举（从上游 memes.js 移植） ----

export const SEND_MODES = ["auto", "text", "image"] as const;
export type SendMode = (typeof SEND_MODES)[number];

export function normalizeSendMode(value: unknown): SendMode {
  return SEND_MODES.includes(value as SendMode) ? (value as SendMode) : "auto";
}

export const DEFAULT_SEND_CHANCE = 30;

export function normalizeSendChance(value: unknown): number {
  if (value == null || value === "") return DEFAULT_SEND_CHANCE;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SEND_CHANCE;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export const LAYOUT_MODES = ["inline", "stacked"] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];

export function normalizeLayoutMode(value: unknown): LayoutMode {
  return LAYOUT_MODES.includes(value as LayoutMode) ? (value as LayoutMode) : "inline";
}
