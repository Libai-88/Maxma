/**
 * stickers/market.ts — dsh-meme 远端图库目录 / ZIP 安装导出。
 *
 * 目录源与镜像顺序移植自 dsh-meme index.js；不接 Giphy/Tenor、不要求 Key。
 * 安装只在用户点击后发生，SHA-256 强制，ZIP 只接受 root 含 index.db/manifest.json。
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { inflateRawSync } from "node:zlib";
import { Database } from "bun:sqlite";

import {
  BUILTIN_PACK_ID,
  LEGACY_CUSTOM_PACK_ID,
  USER_PACK_ID,
  packsDir,
  stickersDataRoot,
} from "./paths";
import { invalidateStore, listPacks, loadSettings, saveSettings } from "./service";

const MAX_ARCHIVE = 200 * 1024 * 1024;
const MAX_UNCOMPRESSED = 300 * 1024 * 1024;
const MAX_ITEMS = 5000;
const MAX_COMPRESSION_RATIO = 100;
const CATALOG_TTL = 10 * 60 * 1000;
const REMOTE_TIMEOUT = 6000;

const ARCHIVE_HOSTS = new Set([
  "github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "cdn.jsdelivr.net",
  "fastly.jsdelivr.net",
  "testingcf.jsdelivr.net",
  "gcore.jsdelivr.net",
  "cdn.jsdmirror.com",
  "ghfast.top",
  "gh-proxy.com",
  "ghproxy.net",
]);
const IMAGE_EXT_RE = /\.(webp|png|jpg|jpeg|gif)$/i;
const ZIP_META_NAMES = new Set(["manifest.json", "index.db", ".dsh-remote.json", "LICENSE", "LICENSE.txt", "ATTRIBUTION", "ATTRIBUTION.txt", "README.md"]);

export const DEFAULT_REMOTE_DIR_URLS = [
  "https://raw.githubusercontent.com/yyh-001/dsh-meme-packs/main/catalog.json",
  "https://cdn.jsdelivr.net/gh/yyh-001/dsh-meme-packs@main/catalog.json",
  "https://raw.githubusercontent.com/yyh-001/dsh-meme/main/docs/remote-packs.json",
  "https://cdn.jsdelivr.net/gh/yyh-001/dsh-meme@main/docs/remote-packs.json",
];

const GITHUB_MIRROR_PREFIXES = [
  "https://ghfast.top/",
  "https://gh-proxy.com/",
  "https://ghproxy.net/",
];
const JSDELIVR_CDN_HOSTS = ["cdn.jsdelivr.net", "fastly.jsdelivr.net", "testingcf.jsdelivr.net", "gcore.jsdelivr.net"];
const RAW_GH_RE = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/;
const RELEASE_GH_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/(.+)$/;

export interface MarketPack {
  id: string;
  name: string;
  version: string;
  description: string;
  maintainer: string;
  license: string;
  homepage: string;
  count: number;
  archiveUrl: string;
  sha256: string;
  preview: string;
  keywords: string[];
  installed: boolean;
  installedVersion?: string;
}

interface CatalogCache {
  at: number;
  sourceUrl: string;
  source: string;
  packs: MarketPack[];
  warning?: string;
}

function cacheFile(): string {
  return path.join(stickersDataRoot(), "cache", "catalog.json");
}

function readCache(sourceUrl: string): CatalogCache | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(), "utf8")) as CatalogCache;
    if (!raw || raw.sourceUrl !== sourceUrl || !Array.isArray(raw.packs)) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeCache(cache: CatalogCache): void {
  try {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(cacheFile(), JSON.stringify(cache), "utf8");
  } catch {
    /* 缓存失败不影响市场 */
  }
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "::1" || h === "0.0.0.0") return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h) || /^100\.(?:6[4-9]|7\d|8\d|9\d)\./.test(h)) return true;
  if (/^(?:metadata\.google\.internal|metadata\.azure\.com|169\.254\.169\.254)$/.test(h)) return true;
  return false;
}

function parseSafeUrl(raw: string, allowCustomHost: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL 不合法");
  }
  if (url.protocol !== "https:") throw new Error("只接受 HTTPS 地址");
  if (url.username || url.password) throw new Error("URL 不允许携带账号信息");
  if (url.port && url.port !== "443") throw new Error("只接受 443 端口");
  if (isPrivateHost(url.hostname) || /^[\d.]+$/.test(url.hostname)) throw new Error("拒绝私网/回环/IP 地址");
  if (!allowCustomHost && !ARCHIVE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`不允许的下载主机: ${url.hostname}`);
  }
  return url;
}

async function fetchSafe(rawUrl: string, opts: { allowCustomHost: boolean; timeoutMs?: number }): Promise<Response> {
  let current = parseSafeUrl(rawUrl, opts.allowCustomHost).toString();
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(opts.timeoutMs ?? REMOTE_TIMEOUT),
    });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get("location");
    if (!location) throw new Error("重定向缺少 Location");
    current = parseSafeUrl(new URL(location, current).toString(), opts.allowCustomHost).toString();
  }
  throw new Error("重定向超过 5 跳");
}

function withCacheBust(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}t=${Date.now()}`;
}

/** 目录源的候选顺序：tier0 实时源优先，jsDelivr 只在直连失败时兜底。 */
function directoryCandidates(sourceUrl: string): string[] {
  const raw = sourceUrl.trim();
  if (!raw || raw === "auto") return DEFAULT_REMOTE_DIR_URLS;
  if (raw === "official") return [DEFAULT_REMOTE_DIR_URLS[0]!, DEFAULT_REMOTE_DIR_URLS[2]!].filter(Boolean);
  if (raw === "mirror") {
    return DEFAULT_REMOTE_DIR_URLS.slice(2).map((u) => remoteMirrors(u)[0] ?? u);
  }
  return remoteMirrors(raw);
}

export function remoteMirrors(url: string): string[] {
  const raw = String(url || "").trim();
  if (!/^https?:\/\//i.test(raw)) return [];
  const out: string[] = [];
  const push = (value: string) => { if (value && !out.includes(value)) out.push(value); };
  const rawGh = RAW_GH_RE.exec(raw);
  const relGh = RELEASE_GH_RE.exec(raw);
  if (rawGh) {
    const [, owner, repo, ref, file] = rawGh;
    push(`https://cdn.jsdmirror.com/gh/${owner}/${repo}@${ref}/${file}`);
    for (const prefix of GITHUB_MIRROR_PREFIXES) push(prefix + raw);
    push(raw);
    for (const host of JSDELIVR_CDN_HOSTS) push(`https://${host}/gh/${owner}/${repo}@${ref}/${file}`);
  } else if (relGh) {
    for (const prefix of GITHUB_MIRROR_PREFIXES) push(prefix + raw);
    push(raw);
  } else {
    push(raw);
  }
  return out;
}

function slug(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").replace(/^-+|-+$/g, "").slice(0, 40);
}

function normalizeCatalog(raw: unknown): MarketPack[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { packs?: unknown[] }).packs)
      ? (raw as { packs: unknown[] }).packs
      : null;
  if (!list) throw new Error("目录不是数组或 { packs: [] }");
  if (list.length > MAX_ITEMS) throw new Error(`目录超过 ${MAX_ITEMS} 条`);
  const packs = listPacks();
  const installed = new Map(packs.map((p) => [p.id, p.version]));
  const mapped: Array<MarketPack | null> = list.map((entry) => {
      const e = (entry ?? {}) as Record<string, unknown>;
      const archiveUrl = String(e.archiveUrl || "").trim();
      if (!/^https?:\/\//i.test(archiveUrl)) return null;
      const id = slug(e.id);
      if (!id) return null;
      return {
        id,
        name: String(e.name || id).trim().slice(0, 60) || id,
        version: String(e.version || "").trim().slice(0, 40),
        description: String(e.description || "").trim().slice(0, 200),
        maintainer: String(e.maintainer || e.author || "").trim().slice(0, 80),
        license: String(e.license || "").trim().slice(0, 80),
        homepage: String(e.homepage || "").trim().slice(0, 300),
        count: Number(e.count) || 0,
        archiveUrl,
        sha256: String(e.sha256 || "").trim().toLowerCase(),
        preview: String(e.preview || "").trim(),
        keywords: Array.isArray(e.keywords) ? e.keywords.map(String).slice(0, 10) : [],
        installed: installed.has(id),
        installedVersion: installed.get(id) ?? "",
      } satisfies MarketPack;
    });
  return mapped
    .filter((e): e is MarketPack => e !== null)
    .filter((e) => e.sha256.length === 64);
}

export async function fetchMarketCatalog(force = false): Promise<{
  ok: boolean;
  sourceUrl: string;
  source: string;
  fetchedAt: number;
  packs: MarketPack[];
  warning?: string;
}> {
  const settings = loadSettings();
  const sourceUrl = settings.remoteDirUrl || "auto";
  const cached = readCache(sourceUrl);
  if (!force && cached && Date.now() - cached.at <= CATALOG_TTL) {
    return { ok: true, sourceUrl, source: cached.source, fetchedAt: cached.at, packs: refreshInstalled(cached.packs), warning: cached.warning };
  }
  const candidates = directoryCandidates(sourceUrl);
  const attempts = candidates.map(async (url) => {
    const res = await fetchSafe(withCacheBust(url), { allowCustomHost: true });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const packs = normalizeCatalog(json);
    if (packs.length === 0) throw new Error("目录为空");
    return { url, packs };
  });
  try {
    const first = await Promise.any(attempts);
    const cache: CatalogCache = { at: Date.now(), sourceUrl, source: first.url, packs: first.packs };
    writeCache(cache);
    return { ok: true, sourceUrl, source: first.url, fetchedAt: cache.at, packs: refreshInstalled(first.packs) };
  } catch {
    if (cached) {
      return {
        ok: true,
        sourceUrl,
        source: cached.source,
        fetchedAt: cached.at,
        packs: refreshInstalled(cached.packs),
        warning: "在线目录暂不可达，正在使用本地缓存",
      };
    }
    return { ok: false, sourceUrl, source: "", fetchedAt: 0, packs: [], warning: "目录源不可达；可稍后重试或检查网络" };
  }
}

function refreshInstalled(packs: MarketPack[]): MarketPack[] {
  const installed = new Map(listPacks().map((p) => [p.id, p.version]));
  return packs.map((p) => ({ ...p, installed: installed.has(p.id), installedVersion: installed.get(p.id) }));
}

// ---- ZIP（store + deflate 读取；导出用 store） ----

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

export function zipStore(files: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name.replace(/\\/g, "/"), "utf8");
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, file.data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(file.data.length, 20);
    entry.writeUInt32LE(file.data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + file.data.length;
  }
  const cdSize = central.reduce((sum, b) => sum + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, eocd]);
}

export function unzipStore(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("不是有效的 ZIP 文件");
  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_ITEMS) throw new Error(`ZIP 条目超过 ${MAX_ITEMS}`);
  let pos = buf.readUInt32LE(eocd + 16);
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error("ZIP 中央目录损坏");
    const flags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const uncompSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const externalAttrs = buf.readUInt32LE(pos + 38);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLen);
    if (flags & 1) throw new Error(`ZIP 含加密条目: ${name}`);
    if ((externalAttrs >>> 16 & 0o170000) === 0o120000) throw new Error(`ZIP 含符号链接: ${name}`);
    if (out.has(name)) throw new Error(`ZIP 含重复条目: ${name}`);
    // 目录条目不承载内容；跳过但保持 enabled/其它文件校验。
    if (name.endsWith("/")) {
      pos += 46 + nameLen + extraLen + commentLen;
      continue;
    }
    if (!ZIP_META_NAMES.has(name) && !IMAGE_EXT_RE.test(name)) throw new Error(`ZIP 含不允许的文件类型: ${name}`);
    if (uncompSize > 0 && compSize > 0 && uncompSize / compSize > MAX_COMPRESSION_RATIO) {
      throw new Error(`ZIP 条目压缩比异常: ${name}`);
    }
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    if (dataStart + compSize > buf.length) throw new Error(`ZIP 条目越界: ${name}`);
    let data: Buffer;
    if (method === 0) data = Buffer.from(buf.subarray(dataStart, dataStart + compSize));
    else if (method === 8) {
      data = inflateRawSync(buf.subarray(dataStart, dataStart + compSize), { maxOutputLength: MAX_ARCHIVE });
    } else throw new Error(`ZIP 使用了不支持的压缩方式(${method}): ${name}`);
    total += data.length;
    if (total > MAX_UNCOMPRESSED) throw new Error("ZIP 解压后超过 300MB，拒绝处理");
    out.set(name, data);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---- 安装 / 导出 / 删除 ----

function retryRemove(target: string): void {
  for (let i = 0; i < 100; i++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  throw new Error(`无法删除旧图库（文件被占用）: ${target}`);
}

/** SQLite close() 后 Windows 仍可能短暂占用文件，rename 也要重试。 */
function retryRename(from: string, to: string): void {
  let last: unknown;
  for (let i = 0; i < 100; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      last = err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  throw last instanceof Error ? last : new Error(`无法重命名图库目录: ${from}`);
}

function isSafeEntry(rel: string): boolean {
  if (!rel || rel.endsWith("/") || rel.endsWith("\\")) return false;
  const normalized = path.posix.normalize(rel.replace(/\\/g, "/"));
  return !normalized.startsWith("../") && !path.posix.isAbsolute(normalized) && normalized !== "..";
}

function validateIndex(dbFile: string): number {
  // 不在 stage 目录内直接打开 index.db：Windows 上 SQLite close 后仍可能短暂占用，
  // 会让紧接着的 stage → target 目录 rename 报 EPERM。复制到系统临时目录再校验。
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-pack-check-"));
  const tempDb = path.join(tempDir, "index.db");
  try {
    fs.copyFileSync(dbFile, tempDb);
    const db = new Database(tempDb, { readonly: true });
    try {
      const row = db.prepare("SELECT COUNT(*) AS n FROM memes").get() as { n?: number } | null;
      return Number(row?.n) || 0;
    } finally {
      db.close();
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* 临时目录交给系统 */
    }
  }
}

export interface InstallResult {
  id: string;
  name: string;
  version: string;
  total: number;
  replaced: boolean;
}

export function installArchiveBuffer(
  buf: Buffer,
  opts: { archiveUrl: string; sha256: string; requestedId?: string; name?: string; version?: string },
): InstallResult {
  if (buf.length === 0 || buf.length > MAX_ARCHIVE) throw new Error("ZIP 大小超限（≤200MB）");
  const actual = crypto.createHash("sha256").update(buf).digest("hex");
  if (opts.sha256 && actual !== opts.sha256.toLowerCase()) throw new Error("ZIP SHA-256 校验失败");
  const entries = unzipStore(buf);
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(entries.get("manifest.json")?.toString("utf8") || "{}") as Record<string, unknown>;
  } catch {
    throw new Error("manifest.json 不是合法 JSON");
  }
  const requestedId = slug(opts.requestedId);
  const manifestId = slug(manifest.id);
  const id = requestedId || manifestId;
  if (!id) throw new Error("ZIP manifest.json 缺少有效 id");
  if (requestedId && manifestId && requestedId !== manifestId) throw new Error("目录 id 与 ZIP manifest id 不一致");
  if (!entries.get("index.db")) throw new Error("ZIP 里没有 index.db，不是有效的表情包");
  for (const rel of entries.keys()) {
    if (!isSafeEntry(rel)) throw new Error(`ZIP 条目路径越界: ${rel}`);
  }
  const name = String(manifest.name || opts.name || id).trim().slice(0, 60) || id;
  const version = String(manifest.version || opts.version || "").trim().slice(0, 40);
  const root = packsDir();
  fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, id);
  if (!path.resolve(target).startsWith(path.resolve(root) + path.sep)) throw new Error("图库目录越界");
  const nonce = crypto.randomBytes(4).toString("hex");
  const stage = path.join(root, `${id}.tmp-${nonce}`);
  const backup = path.join(root, `${id}.bak-${nonce}`);
  fs.mkdirSync(stage, { recursive: true });
  try {
    for (const [rel, data] of entries) {
      if (!isSafeEntry(rel)) continue;
      const full = path.join(stage, ...rel.split("/"));
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, data);
    }
    const total = validateIndex(path.join(stage, "index.db"));
    if (total <= 0) throw new Error("index.db 里没有表情");
    fs.writeFileSync(
      path.join(stage, ".dsh-remote.json"),
      JSON.stringify({ sourceType: "archive", archiveUrl: opts.archiveUrl, sha256: actual, id, name, version, lastSync: Date.now() }, null, 2),
    );
    const replaced = fs.existsSync(target);
    if (replaced) {
      retryRemove(backup);
      retryRename(target, backup);
    }
    try {
      retryRename(stage, target);
    } catch (err) {
      if (replaced && fs.existsSync(backup) && !fs.existsSync(target)) retryRename(backup, target);
      throw err;
    }
    try {
      retryRemove(backup);
    } catch {
      /* 目标已经切换成功，旧备份残留不应让安装失败 */
    }
    invalidateStore(id);
    const settings = loadSettings();
    saveSettings({
      enabledPacks: settings.enabledPacks.includes(id) ? settings.enabledPacks : [...settings.enabledPacks, id],
      remoteSubs: [...new Set([id, ...(settings.remoteSubs || [])])],
    });
    return { id, name, version, total, replaced };
  } finally {
    try {
      retryRemove(stage);
    } catch {
      /* rename 已失败时不要用清理错误覆盖原始错误；残留 staging 会在下次安装前清理 */
    }
  }
}

export async function installRemotePack(opts: {
  archiveUrl: string;
  sha256: string;
  id?: string;
  name?: string;
  version?: string;
}): Promise<InstallResult> {
  if (!/^https?:\/\//i.test(opts.archiveUrl)) throw new Error("archiveUrl 必须是 http(s)");
  if (!/^[0-9a-f]{64}$/i.test(opts.sha256)) throw new Error("必须提供 SHA-256");
  let last = "";
  for (const url of remoteMirrors(opts.archiveUrl)) {
    try {
      const res = await fetchSafe(url, { allowCustomHost: false, timeoutMs: 20_000 });
      if (!res.ok) { last = `HTTP ${res.status}`; continue; }
      const declared = Number(res.headers.get("content-length") || 0);
      if (declared > MAX_ARCHIVE) throw new Error("ZIP 超过 200MB");
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_ARCHIVE) throw new Error("ZIP 超过 200MB");
      return installArchiveBuffer(buf, opts);
    } catch (err) {
      if (err instanceof Error && /SHA-256|200MB|manifest|index\.db|不允许|HTTPS|私网|主机|URL/.test(err.message)) throw err;
      last = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`ZIP 下载失败: ${last || "未知错误"}`);
}

function walk(root: string, prefix = ""): Array<{ name: string; data: Buffer }> {
  const out: Array<{ name: string; data: Buffer }> = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(root, rel));
    else out.push({ name: rel, data: fs.readFileSync(path.join(root, rel)) });
  }
  return out;
}

export function exportPack(packId: string): { filename: string; buffer: Buffer } {
  const pack = listPacks().find((p) => p.id === packId);
  if (!pack) throw new Error("图库不存在");
  const safe = slug(pack.id);
  if (!safe) throw new Error("非法图库 id");
  return { filename: `${safe}.zip`, buffer: zipStore(walk(pack.path)) };
}

export function deleteRemotePack(packId: string): boolean {
  const pack = listPacks().find((p) => p.id === packId);
  if (!pack) return false;
  if ([BUILTIN_PACK_ID, USER_PACK_ID, LEGACY_CUSTOM_PACK_ID].includes(pack.id)) return false;
  const marker = path.join(pack.path, ".dsh-remote.json");
  if (!fs.existsSync(marker)) return false;
  retryRemove(pack.path);
  invalidateStore(packId);
  const settings = loadSettings();
  saveSettings({
    enabledPacks: settings.enabledPacks.filter((id) => id !== packId),
    remoteSubs: (settings.remoteSubs || []).filter((id) => id !== packId),
    packId: settings.packId === packId ? BUILTIN_PACK_ID : settings.packId,
  });
  return true;
}
