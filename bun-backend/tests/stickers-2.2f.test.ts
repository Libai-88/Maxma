/**
 * tests/stickers-2.2f.test.ts — stickers 三模块单测（阶段 2.2f）。
 *
 * 隔离：MAXMA_BUNDLE_DIR/MAXMA_DATA_DIR 指临时目录，造内置/自定义表情。
 * 上传转换用 sharp 真实跑（小 PNG）。
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let dataDir = "";
let prevDataDir: string | undefined;
let prevBundleDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-stk-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  prevBundleDir = process.env.MAXMA_BUNDLE_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  process.env.MAXMA_BUNDLE_DIR = dataDir;
  // 内置表情：开心/cat_1.webp、爱心/cat_2.webp
  for (const [cat, file] of [["开心", "a.webp"], ["爱心", "b.webp"]] as const) {
    const dir = path.join(dataDir, "config", "stickers", cat);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, file), Buffer.alloc(8));
  }
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  if (prevBundleDir === undefined) delete process.env.MAXMA_BUNDLE_DIR;
  else process.env.MAXMA_BUNDLE_DIR = prevBundleDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function makeApp() {
  const { createApp } = await import("../src/server");
  return createApp();
}

function authHeader(): Record<string, string> {
  const { Database } = require("bun:sqlite") as {
    Database: new (p: string, o?: object) => { query: (s: string) => { get: () => { token: string } | null } };
  };
  const db = new Database(path.join(dataDir, "api", "data", "maxma.db"), { readonly: true });
  try {
    const row = db.query("SELECT token FROM auth_tokens ORDER BY id DESC LIMIT 1").get();
    return { "x-maxma-token": row?.token ?? "" };
  } finally {
    db.close();
  }
}

/** 生成一个最小合法 PNG（sharp 可转换）。 */
function tinyPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

describe("stickers 文件服务（阶段 2.2f）", () => {
  test("分类列表 + 随机 + 文件访问 + 非法名 400", async () => {
    const app = await makeApp();
    const h = authHeader();

    const list = (await (await app.request("/api/stickers", { headers: h })).json()) as {
      categories: Record<string, number>;
    };
    expect(list.categories["开心"]).toBe(1);
    expect(list.categories["爱心"]).toBe(1);

    const random = (await (
      await app.request(`/api/stickers/random/${encodeURIComponent("开心")}`, { headers: h })
    ).json()) as { path: string; category: string };
    expect(random.category).toBe("开心");
    expect(random.path).toContain("a.webp");

    const file = await app.request(`/api/stickers/${encodeURIComponent("开心")}/a.webp`, { headers: h });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/webp");
    expect(file.headers.get("cache-control")).toContain("immutable");

    const badCat = await app.request("/api/stickers/bad..cat/a.webp", { headers: h });
    expect(badCat.status).toBe(400);
    const badFile = await app.request(`/api/stickers/${encodeURIComponent("开心")}/%2e%2e%2fx.webp`, { headers: h });
    expect(badFile.status).toBe(400); // decode 后 filename=../x.webp，FILENAME_RE 拒绝
  });
});

describe("stickers favorites（阶段 2.2f）", () => {
  test("添加/重复/取消/列表 path 字段", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };

    const add = (await (
      await app.request("/api/stickers/favorites", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ category: "开心", filename: "a.webp" }),
      })
    ).json()) as { success: boolean };
    expect(add.success).toBe(true);

    const dup = (await (
      await app.request("/api/stickers/favorites", {
        method: "POST",
        headers: h,
        body: JSON.stringify({ category: "开心", filename: "a.webp" }),
      })
    ).json()) as { success: boolean; message: string };
    expect(dup.success).toBe(false);
    expect(dup.message).toBe("已在收藏中");

    const list = (await (await app.request("/api/stickers/favorites", { headers: h })).json()) as {
      favorites: Array<{ path: string }>;
    };
    expect(list.favorites[0]!.path).toBe("开心/a.webp");

    const remove = (await (
      await app.request("/api/stickers/favorites?filename=a.webp&category=开心", { method: "DELETE", headers: h })
    ).json()) as { success: boolean };
    expect(remove.success).toBe(true);

    const notFound = (await (
      await app.request("/api/stickers/favorites?filename=a.webp&category=开心", { method: "DELETE", headers: h })
    ).json()) as { success: boolean; message: string };
    expect(notFound.message).toBe("未找到收藏");
  });

  test("不存在的表情 → 404（favorites/usage/skip）", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };
    for (const ep of ["/api/stickers/favorites", "/api/stickers/usage", "/api/stickers/skip"]) {
      const res = await app.request(ep, {
        method: ep === "/api/stickers/favorites" ? "POST" : "POST",
        headers: h,
        body: JSON.stringify({ category: "开心", filename: "ghost.webp" }),
      });
      expect(res.status).toBe(404);
    }
  });

  test("recommendations 返回 limit 条以内 + index 双目录", async () => {
    const app = await makeApp();
    const h = authHeader();
    const rec = (await (
      await app.request("/api/stickers/recommendations?limit=4", { headers: h })
    ).json()) as { recommendations: Array<{ path: string }> };
    expect(rec.recommendations.length).toBeGreaterThan(0);
    expect(rec.recommendations.length).toBeLessThanOrEqual(4);

    const index = (await (await app.request("/api/stickers/index", { headers: h })).json()) as {
      index: Record<string, unknown>;
    };
    expect(Object.keys(index.index)).toContain("开心/a.webp");
  });
});

describe("stickers upload（阶段 2.2f）", () => {
  test("上传 PNG → 转 WebP 落盘 → 列表 → 删除；重复上传幂等", async () => {
    const app = await makeApp();
    const h = authHeader();

    const form = new FormData();
    form.append("file", new File([tinyPng()], "sticker.png", { type: "image/png" }));
    const upload = (await (
      await app.request("/api/stickers/upload", { method: "POST", headers: h, body: form })
    ).json()) as { success: boolean; filename: string; path: string };
    expect(upload.success).toBe(true);
    expect(upload.filename).toMatch(/^custom_[0-9a-f]{16}\.webp$/);
    expect(fs.existsSync(path.join(dataDir, "config", "stickers", "custom", upload.filename))).toBe(true);

    // 重复上传（同内容同哈希）
    const form2 = new FormData();
    form2.append("file", new File([tinyPng()], "sticker.png", { type: "image/png" }));
    const again = (await (
      await app.request("/api/stickers/upload", { method: "POST", headers: h, body: form2 })
    ).json()) as { message: string };
    expect(again.message).toContain("已存在");

    // custom 列表
    const list = (await (await app.request("/api/stickers/custom", { headers: h })).json()) as {
      stickers: Array<{ filename: string }>;
    };
    expect(list.stickers.some((s) => s.filename === upload.filename)).toBe(true);

    // 删除
    const del = (await (
      await app.request(`/api/stickers/custom/${upload.filename}`, { method: "DELETE", headers: h })
    ).json()) as { success: boolean };
    expect(del.success).toBe(true);

    // 非法文件名 400
    const bad = await app.request("/api/stickers/custom/evil.webp", { method: "DELETE", headers: h });
    expect(bad.status).toBe(400);
  });

  test("不支持的格式 400；缺文件 400", async () => {
    const app = await makeApp();
    const h = { "content-type": "application/json", ...authHeader() };

    const form = new FormData();
    form.append("file", new File([Buffer.alloc(4)], "sticker.bmp", { type: "image/bmp" }));
    const bad = await app.request("/api/stickers/upload", { method: "POST", headers: h, body: form });
    expect(bad.status).toBe(400);

    const empty = await app.request("/api/stickers/upload", { method: "POST", headers: h, body: new FormData() });
    expect(empty.status).toBe(400);
  });
});
