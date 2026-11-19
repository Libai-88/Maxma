/**
 * tests/stickers-legacy-server.test.ts — MAXMA_STICKER_ENGINE=legacy 的完整装配。
 *
 * 与 stickers-legacy-route 的区别：这里走真实 createApp()，验证回滚开关在
 * 服务级装配里只挂旧路由（分类/图片/随机/收藏/索引），不挂 dsh-meme 新路由。
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let root = "";
let prevData: string | undefined;
let prevBundle: string | undefined;
let prevEngine: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-legacy-app-"));
  prevData = process.env.MAXMA_DATA_DIR;
  prevBundle = process.env.MAXMA_BUNDLE_DIR;
  prevEngine = process.env.MAXMA_STICKER_ENGINE;
  process.env.MAXMA_DATA_DIR = root;
  process.env.MAXMA_BUNDLE_DIR = root;
  process.env.MAXMA_STICKER_ENGINE = "legacy";
  fs.mkdirSync(path.join(root, "config", "stickers", "开心"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "stickers", "开心", "a.webp"), Buffer.from([0x52, 0x49, 0x46, 0x46]));
});

afterEach(() => {
  if (prevData === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevData;
  if (prevBundle === undefined) delete process.env.MAXMA_BUNDLE_DIR;
  else process.env.MAXMA_BUNDLE_DIR = prevBundle;
  if (prevEngine === undefined) delete process.env.MAXMA_STICKER_ENGINE;
  else process.env.MAXMA_STICKER_ENGINE = prevEngine;
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {
    /* Windows SQLite 句柄可能延迟释放 */
  }
});

describe("legacy engine 完整服务装配", () => {
  test("旧分类/图片/随机/收藏/索引可用，新 pack 路由不挂载", async () => {
    const { createApp } = await import("../src/server");
    const app = createApp();
    const token = (await (await app.request("/api/auth/token")).json() as { token: string }).token;
    const H = { "x-maxma-token": token, "content-type": "application/json" };

    const list = await app.request("/api/stickers", { headers: H });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { categories: Record<string, number> };
    expect(body.categories["开心"]).toBe(1);

    const image = await app.request("/api/stickers/%E5%BC%80%E5%BF%83/a.webp", { headers: H });
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/webp");

    const random = await app.request("/api/stickers/random/%E5%BC%80%E5%BF%83", { headers: H });
    expect(random.status).toBe(200);

    const fav = await app.request("/api/stickers/favorites", {
      method: "POST",
      headers: H,
      body: JSON.stringify({ category: "开心", filename: "a.webp" }),
    });
    expect(fav.status).toBe(200);
    expect((await fav.json() as { success: boolean }).success).toBe(true);

    const oldIndex = await app.request("/api/stickers/index", { headers: H });
    expect(oldIndex.status).toBe(200);
    const oldIndexBody = (await oldIndex.json()) as { index?: Record<string, unknown>; packs?: unknown };
    expect(oldIndexBody.index?.["开心/a.webp"]).toBeTruthy();
    expect(oldIndexBody.packs).toBeUndefined();

    const newPackRoute = await app.request("/api/stickers/packs", { headers: H });
    expect(newPackRoute.status).toBe(404);
  });

  test("切回 dsh 引擎后新路由可用、旧 shim 让位", async () => {
    process.env.MAXMA_STICKER_ENGINE = "dsh";
    const { createApp } = await import("../src/server");
    const app = createApp();
    const token = (await (await app.request("/api/auth/token")).json() as { token: string }).token;
    const H = { "x-maxma-token": token };
    const packs = await app.request("/api/stickers/packs", { headers: H });
    expect(packs.status).toBe(200);
  });
});
