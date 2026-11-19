/**
 * tests/stickers-migration.test.ts — 旧数据迁移 M0-M5 的幂等与不丢数据契约。
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { initStickerSystem, migrationStatus, runStickerMigration } from "../src/stickers/service";

let root = "";
let prevData: string | undefined;
let prevBundle: string | undefined;

function writePng(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-mig-"));
  prevData = process.env.MAXMA_DATA_DIR;
  prevBundle = process.env.MAXMA_BUNDLE_DIR;
  process.env.MAXMA_DATA_DIR = root;
  process.env.MAXMA_BUNDLE_DIR = root;
  writePng(path.join(root, "config", "stickers", "开心", "a.webp"));
  writePng(path.join(root, "config", "stickers", "生气", "b.webp"));
  writePng(path.join(root, "config", "stickers", "custom", "custom_old.webp"));
  fs.mkdirSync(path.join(root, "api", "data"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "api", "data", "sticker_favorites.yaml"),
    "favorites:\n  - category: 开心\n    filename: a.webp\n    added_at: '2025-01-01T00:00:00Z'\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "api", "data", "sticker_recent.yaml"),
    "recent:\n  - category: 开心\n    filename: a.webp\n    used_at: '2025-01-02T00:00:00Z'\n",
    "utf8",
  );
  fs.writeFileSync(path.join(root, "api", "data", "sticker_preferences.yaml"), "x: 1\n", "utf8");
});

afterEach(() => {
  if (prevData === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevData;
  if (prevBundle === undefined) delete process.env.MAXMA_BUNDLE_DIR;
  else process.env.MAXMA_BUNDLE_DIR = prevBundle;
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* Windows SQLite 句柄延迟释放 */
  }
});

test("迁移：备份旧 YAML/custom，内置与 custom 建库，favorites 复制，幂等", () => {
  initStickerSystem();
  const first = migrationStatus();
  expect(first?.ok).toBe(true);
  expect(first?.custom.copied).toBeGreaterThanOrEqual(1);
  expect(first?.favorites.copied).toBeGreaterThanOrEqual(1);
  expect(first?.reconcile.builtinRows).toBe(2);
  expect(first?.reconcile.legacyRows).toBe(1);
  expect(fs.existsSync(path.join(first!.backupDir, "api", "data", "sticker_favorites.yaml"))).toBe(true);
  expect(fs.existsSync(path.join(first!.backupDir, "config", "stickers", "custom", "custom_old.webp"))).toBe(true);
  expect(fs.existsSync(path.join(root, "stickers", "packs", "maxma_legacy_custom", "custom", "custom_old.webp"))).toBe(true);
  expect(fs.existsSync(path.join(root, "stickers", "packs", "dsh-meme-user", "memes", "happy", "a.webp"))).toBe(true);
  expect(fs.existsSync(path.join(root, "api", "data", "sticker_favorites.yaml"))).toBe(true);
  expect(fs.existsSync(path.join(root, "config", "stickers", "custom", "custom_old.webp"))).toBe(true);
  const at = first!.at;
  const second = runStickerMigration();
  expect(second.at).toBe(at);
});
