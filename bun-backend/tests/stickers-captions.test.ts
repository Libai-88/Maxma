/**
 * 内置图语义 caption：build.ts 读取 captions.json，且 captions.json 更新会使索引失效。
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildBuiltinPack, builtinIndexIsCurrent } from "../src/stickers/build";

let root = "";
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-stk-caption-"));
});
afterEach(() => {
  for (let i = 0; i < 40; i++) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
});

function makePack(): string {
  const dir = path.join(root, "pack");
  fs.mkdirSync(path.join(dir, "委屈"), { recursive: true });
  fs.mkdirSync(path.join(dir, "开心"), { recursive: true });
  fs.writeFileSync(path.join(dir, "委屈", "a.webp"), Buffer.alloc(8));
  fs.writeFileSync(path.join(dir, "开心", "b.webp"), Buffer.alloc(8));
  fs.writeFileSync(
    path.join(dir, "captions.json"),
    JSON.stringify({
      "委屈/a.webp": { caption: "委屈：棕熊趴在桌上低头", keywords: "委屈 棕熊 低头" },
      "开心/b.webp": { caption: "开心：小羊大笑", keywords: "开心 小羊 大笑" },
    }),
    "utf8",
  );
  return dir;
}

test("captions.json 覆盖索引 caption/keywords，并标记已标注", () => {
  const dir = makePack();
  const result = buildBuiltinPack(dir, true);
  expect(result.count).toBe(2);
  const db = new Database(path.join(dir, "index.db"), { readonly: true });
  try {
    const row = db.prepare("SELECT caption, keywords, captioned_at FROM memes WHERE path = ?").get("委屈/a.webp") as {
      caption: string;
      keywords: string;
      captioned_at: number | null;
    };
    expect(row.caption).toBe("委屈：棕熊趴在桌上低头");
    expect(row.keywords).toBe("委屈 棕熊 低头");
    expect(row.captioned_at).not.toBeNull();
  } finally {
    db.close();
  }
});

test("没有 captions.json 时退回分类+文件名，不阻断生成", () => {
  const dir = makePack();
  fs.rmSync(path.join(dir, "captions.json"));
  buildBuiltinPack(dir, true);
  const db = new Database(path.join(dir, "index.db"), { readonly: true });
  try {
    const row = db.prepare("SELECT caption, captioned_at FROM memes WHERE path = ?").get("委屈/a.webp") as {
      caption: string;
      captioned_at: number | null;
    };
    expect(row.caption).toBe("委屈 a");
    expect(row.captioned_at).toBeNull();
  } finally {
    db.close();
  }
});

test("captions.json 比 index.db 新时索引被判定为过期", () => {
  const dir = makePack();
  buildBuiltinPack(dir, true);
  expect(builtinIndexIsCurrent(dir)).toBe(true);
  const captions = path.join(dir, "captions.json");
  const newer = new Date(Date.now() + 5000);
  fs.utimesSync(captions, newer, newer);
  expect(builtinIndexIsCurrent(dir)).toBe(false);
});
