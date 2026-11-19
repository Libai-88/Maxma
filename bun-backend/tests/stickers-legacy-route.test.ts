/**
 * tests/stickers-legacy-route.test.ts — MAXMA_STICKER_ENGINE=legacy 的旧协议 shim。
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { initStickerSystem } from "../src/stickers/service";
import { createLegacyStickerCompatRoutes } from "../src/routes/stickers";

let root = "";
let prevData: string | undefined;
let prevBundle: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-legacy-"));
  prevData = process.env.MAXMA_DATA_DIR;
  prevBundle = process.env.MAXMA_BUNDLE_DIR;
  process.env.MAXMA_DATA_DIR = root;
  process.env.MAXMA_BUNDLE_DIR = root;
  fs.mkdirSync(path.join(root, "config", "stickers", "开心"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "stickers", "开心", "a.webp"), Buffer.from([0x52, 0x49, 0x46, 0x46]));
  initStickerSystem();
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

test("legacy shim：分类列表、旧图片、随机接口可用", async () => {
  const app = createLegacyStickerCompatRoutes();
  const list = await app.request("/api/stickers");
  expect(list.status).toBe(200);
  const body = (await list.json()) as { categories: Record<string, number> };
  expect(body.categories["开心"]).toBe(1);

  const image = await app.request("/api/stickers/%E5%BC%80%E5%BF%83/a.webp");
  expect(image.status).toBe(200);
  expect(image.headers.get("content-type")).toBe("image/webp");

  const random = await app.request("/api/stickers/random/%E5%BC%80%E5%BF%83");
  expect(random.status).toBe(200);
});
