/**
 * 把 Maxma 旧内置目录 config/stickers 生成 dsh-meme 兼容的 maxma_builtin pack：
 *   index.db + manifest.json，图片原地不动，path 保留 `<分类>/<文件>`。
 *
 * 这是构建/首次启动的生成器，不参与请求路径；生成失败时调用方应保留旧系统可用。
 */
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

import { legacyTagForCategory, walkPackImages } from "../../../bun-shared/dsh-meme/memes";

const IMAGE_EXTS = new Set([".webp", ".png", ".jpg", ".jpeg", ".gif"]);
const TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS memes (path TEXT PRIMARY KEY, tag TEXT, file_name TEXT, caption TEXT, keywords TEXT, mtime REAL, captioned_at REAL)";

export interface BuildBuiltinResult {
  dir: string;
  count: number;
  rebuilt: boolean;
}

function imageFiles(dir: string): string[] {
  return walkPackImages(dir)
    .filter((rel) => {
      const first = rel.split("/")[0];
      return first !== "custom" && !rel.startsWith("custom/");
    })
    .filter((rel) => {
      const ext = path.extname(rel).toLowerCase();
      return IMAGE_EXTS.has(ext);
    });
}

function readExistingPaths(indexPath: string): string[] | null {
  if (!fs.existsSync(indexPath)) return null;
  try {
    const db = new Database(indexPath, { readonly: true });
    try {
      const rows = db.prepare("SELECT path FROM memes").all() as Array<{ path: string }>;
      return rows.map((r) => r.path);
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Windows 上 Bun 的 SQLite close 可能把文件句柄留几十/几百毫秒，删除要重试。 */
function removeWithRetry(file: string): void {
  let last: unknown;
  for (let i = 0; i < 40; i++) {
    try {
      fs.rmSync(file, { force: true });
      return;
    } catch (err) {
      last = err;
      sleepSync(50);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function writeIndex(dir: string, images: string[], reuseExisting = false): void {
  const indexPath = path.join(dir, "index.db");
  // Windows 上 SQLite close 后源文件句柄可能仍被占用，tmp→rename 会 EBUSY。
  // 如果索引本来就能读，优先在同一个文件里清空重写，避免删除正被 SQLite 句柄
  // 短暂占用的 index.db；只有文件损坏/不存在时才删除后重建。
  let db: Database | null = null;
  if (reuseExisting) {
    try {
      db = new Database(indexPath);
      db.exec("BEGIN IMMEDIATE");
      db.exec("DELETE FROM memes");
    } catch {
      try {
        db?.close();
      } catch {
        /* ignore */
      }
      db = null;
    }
  }
  if (!db) {
    removeWithRetry(indexPath);
    db = new Database(indexPath);
    db.exec(TABLE_SQL);
    db.exec("BEGIN IMMEDIATE");
  }
  try {
    const insert = db.prepare(
      "INSERT OR REPLACE INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const rel of images) {
      const posix = rel.replace(/\\/g, "/");
      const segs = posix.split("/").filter(Boolean);
      const category = segs.length >= 2 ? segs[0]! : "日常";
      const file = segs[segs.length - 1] || "";
      const stem = path.basename(file, path.extname(file));
      const abs = path.join(dir, ...segs);
      let mtime = Date.now();
      try {
        mtime = fs.statSync(abs).mtimeMs;
      } catch {
        /* 保留当前时间即可 */
      }
      insert.run(
        posix,
        legacyTagForCategory(category),
        file,
        `${category} ${stem}`.slice(0, 200),
        category,
        mtime,
        null,
      );
    }
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* 事务未开始/已结束 */
    }
    throw err;
  } finally {
    db.close();
  }
}

function writeManifest(dir: string, count: number, images: string[]): void {
  const manifestPath = path.join(dir, "manifest.json");
  let prev: Record<string, unknown> = {};
  try {
    prev = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  } catch {
    /* 无旧 manifest */
  }
  const manifest = {
    id: "maxma_builtin",
    name: typeof prev.name === "string" && prev.name ? prev.name : "Maxma 内置表情",
    description:
      typeof prev.description === "string" && prev.description
        ? prev.description
        : "Maxma 随包表情图库（旧分类目录原地转为 dsh-meme pack）",
    version: typeof prev.version === "string" && prev.version ? prev.version : "1.0.0",
    count,
    license: "LicenseRef-Maxma-Bundled",
    source: "builtin",
    updatedAt: Date.now(),
    covers: images.slice(0, 8),
  };
  const tmp = `${manifestPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), "utf8");
    fs.renameSync(tmp, manifestPath);
  } finally {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best-effort */
    }
  }
}

/**
 * 生成/校验内置 pack。若索引存在且行集合与图片集合一致，不重写。
 * @param force true 时强制重建
 */
export function buildBuiltinPack(dir: string, force = false): BuildBuiltinResult {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error(`内置表情目录不存在: ${abs}`);
  }
  const images = imageFiles(abs);
  const indexPath = path.join(abs, "index.db");
  const existing = readExistingPaths(indexPath);
  const same =
    !force &&
    existing !== null &&
    existing.length === images.length &&
    existing.every((p, i) => p === images[i]);
  if (same) {
    return { dir: abs, count: images.length, rebuilt: false };
  }
  writeIndex(abs, images, existing !== null);
  writeManifest(abs, images.length, images);
  return { dir: abs, count: images.length, rebuilt: true };
}

export function builtinIndexIsCurrent(dir: string): boolean {
  const images = imageFiles(path.resolve(dir));
  const existing = readExistingPaths(path.join(path.resolve(dir), "index.db"));
  return (
    existing !== null &&
    existing.length === images.length &&
    existing.every((p, i) => p === images[i])
  );
}
