/**
 * tests/stickers-tools.test.ts — send_meme / meme_list / meme_update / learn_meme / get_sticker 契约。
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ensurePackAt, openIndexWriter } from "../../bun-shared/dsh-meme/memes";

let root = "";
let prevData: string | undefined;
let prevBundle: string | undefined;

function writePng(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
}

function addRow(packDir: string, rel: string, tag: string, caption: string, keywords: string): void {
  const writer = openIndexWriter(packDir);
  try {
    writer
      .prepare("INSERT OR REPLACE INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(rel, tag, path.basename(rel), caption, keywords, Date.now(), null);
  } finally {
    writer.close();
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-tools-"));
  prevData = process.env.MAXMA_DATA_DIR;
  prevBundle = process.env.MAXMA_BUNDLE_DIR;
  process.env.MAXMA_DATA_DIR = root;
  process.env.MAXMA_BUNDLE_DIR = root;
  writePng(path.join(root, "config", "stickers", "开心", "a.webp"));
  ensurePackAt(path.join(root, "config", "stickers"), { id: "maxma_builtin", name: "内置" });
  addRow(path.join(root, "config", "stickers"), "开心/a.webp", "happy", "猫猫开心", "猫 开心");
  const user = path.join(root, "stickers", "packs", "dsh-meme-user");
  ensurePackAt(user, { id: "dsh-meme-user", name: "我的收藏" });
  writePng(path.join(user, "memes", "sad", "old.png"));
  addRow(user, "memes/sad/old.png", "sad", "旧图", "旧 悲伤");
  fs.mkdirSync(path.join(root, "stickers"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "stickers", "settings.json"),
    JSON.stringify({ enabledPacks: ["maxma_builtin", "dsh-meme-user"], sendMode: "auto" }, null, 2),
  );
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

async function loadTools() {
  const mod = await import("../src/tools/stickers");
  return {
    send: mod.sendMemeTool(),
    list: mod.memeListTool(),
    update: mod.memeUpdateTool(),
    learn: mod.learnMemeTool(),
    legacy: mod.getStickerTool(),
  };
}

describe("dsh-meme 工具面", () => {
  test("send_meme 按 query 命中 → [表情: 描述]；未命中不随机", async () => {
    const { send } = await loadTools();
    const hit = await send.execute("t1", { query: "猫" });
    expect(hit.details.ok).toBe(true);
    expect(hit.details.mode).toBe("keyword");
    expect(String(hit.content[0].text)).toContain("[表情: 猫猫开心]");
    const miss = await send.execute("t2", { query: "完全不存在的词" });
    expect(miss.details.ok).toBe(false);
    expect(String(miss.content[0].text)).toContain("没有找到");
  });

  test("meme_list 过滤 tag 与 packId", async () => {
    const { list } = await loadTools();
    const all = await list.execute("t1", {});
    expect(all.details.ok).toBe(true);
    expect(all.details.total).toBe(2);
    const sad = await list.execute("t2", { tag: "sad", packId: "dsh-meme-user" });
    expect(sad.details.ok).toBe(true);
    expect(sad.details.total).toBe(1);
    expect(String(sad.content[0].text)).toContain("旧图");
  });

  test("meme_update 只改索引；内置 pack 拒绝", async () => {
    const { list, update } = await loadTools();
    const result = await list.execute("t1", { packId: "maxma_builtin" });
    const builtinPath = String((result.details.memes as Array<{ path: string }>)[0]!.path);
    const refused = await update.execute("t2", { path: builtinPath, caption: "x" });
    expect(refused.details.ok).toBe(false);
    expect(String(refused.content[0].text)).toContain("内置");
    const userPath = path.join(root, "stickers", "packs", "dsh-meme-user", "memes", "sad", "old.png");
    const ok = await update.execute("t3", { path: userPath, caption: "新描述", tag: "shy" });
    expect(ok.details.ok).toBe(true);
    const after = await list.execute("t4", { packId: "dsh-meme-user", tag: "shy" });
    expect(after.details.total).toBe(1);
  });

  test("learn_meme 收录原始字节并写索引；缺 tag 默认 daily", async () => {
    const { learn, list } = await loadTools();
    const src = path.join(root, "incoming", "pic.png");
    writePng(src);
    const result = await learn.execute("t1", { sourcePath: src, caption: "新表情" });
    expect(result.details.ok).toBe(true);
    expect(result.details.tag).toBe("daily");
    const listed = await list.execute("t2", { q: "新表情", packId: "dsh-meme-user" });
    expect(listed.details.total).toBe(1);
    expect(fs.existsSync(path.join(root, "stickers", "packs", "dsh-meme-user", ...String(result.details.path).split("/")))).toBe(true);
  });

  test("learn_meme 拒绝非图片字节", async () => {
    const { learn } = await loadTools();
    const src = path.join(root, "incoming", "bad.txt");
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.writeFileSync(src, "not an image");
    const result = await learn.execute("t1", { sourcePath: src });
    expect(result.details.ok).toBe(false);
    expect(String(result.content[0].text)).toContain("不是可识别");
  });

  test("get_sticker 保留分类别名", async () => {
    const { legacy } = await loadTools();
    const cats = await legacy.execute("t1", {});
    expect((cats.details.categories as Array<unknown>).length).toBeGreaterThanOrEqual(1);
    const one = await legacy.execute("t2", { category: "开心" });
    expect(one.details.found).toBe(true);
    expect(String(one.details.path)).toStartWith("开心/");
  });
});
