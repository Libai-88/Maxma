/**
 * tests/stickers-market.test.ts — ZIP / 市场安装的契约测试。
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createHash } from "node:crypto";
import { ensurePackAt, openIndexWriter } from "../../bun-shared/dsh-meme/memes";
import { exportPack, fetchMarketCatalog, installArchiveBuffer, unzipStore, zipStore } from "../src/stickers/market";
import { indexPayload, initStickerSystem, listPacks, saveSettings } from "../src/stickers/service";

let dataDir = "";
let prevDataDir: string | undefined;
let prevBundleDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-mkt-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  prevBundleDir = process.env.MAXMA_BUNDLE_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  process.env.MAXMA_BUNDLE_DIR = dataDir;
  initStickerSystem();
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  if (prevBundleDir === undefined) delete process.env.MAXMA_BUNDLE_DIR;
  else process.env.MAXMA_BUNDLE_DIR = prevBundleDir;
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* Windows SQLite 句柄可能晚释放；临时目录交给系统 */
  }
});

function makePackZip(id = "demo_pack", extra?: Array<{ name: string; data: Buffer }>): Buffer {
  const stage = path.join(dataDir, "source-pack");
  ensurePackAt(stage, { id, name: "演示图库" });
  fs.mkdirSync(path.join(stage, "memes", "happy"), { recursive: true });
  fs.writeFileSync(path.join(stage, "memes", "happy", "a.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  const writer = openIndexWriter(stage);
  try {
    writer
      .prepare("INSERT OR REPLACE INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("memes/happy/a.png", "happy", "a.png", "猫猫", "猫 开心", Date.now(), null);
  } finally {
    writer.close();
  }
  const files = [
    { name: "manifest.json", data: fs.readFileSync(path.join(stage, "manifest.json")) },
    { name: "index.db", data: fs.readFileSync(path.join(stage, "index.db")) },
    { name: "memes/happy/a.png", data: fs.readFileSync(path.join(stage, "memes", "happy", "a.png")) },
    ...(extra ?? []),
  ];
  return zipStore(files);
}

describe("dsh-meme ZIP 与安装", () => {
  test("zipStore/unzipStore 往返保留全部条目", () => {
    const zip = zipStore([
      { name: "manifest.json", data: Buffer.from('{"id":"x"}') },
      { name: "memes/happy/a.png", data: Buffer.from([1, 2, 3]) },
    ]);
    const entries = unzipStore(zip);
    expect(entries.get("manifest.json")?.toString("utf8")).toBe('{"id":"x"}');
    expect(entries.get("memes/happy/a.png")?.length).toBe(3);
  });

  test("安装成功：写入 packs/demo_pack、启用并返回总数", () => {
    const zip = makePackZip();
    const sha = createHash("sha256").update(zip).digest("hex");
    const result = installArchiveBuffer(zip, { archiveUrl: "https://example.com/demo.zip", sha256: sha });
    expect(result.id).toBe("demo_pack");
    expect(result.total).toBe(1);
    const root = path.join(dataDir, "stickers", "packs", "demo_pack");
    expect(fs.existsSync(path.join(root, "memes", "happy", "a.png"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".dsh-remote.json"))).toBe(true);
    expect(listPacks().some((p) => p.id === "demo_pack" && p.count === 1)).toBe(true);
    const exported = exportPack("demo_pack");
    expect(exported.filename).toBe("demo_pack.zip");
    expect(unzipStore(exported.buffer).get("index.db")?.length).toBeGreaterThan(0);
  });

  test("SHA-256 不一致 → 拒绝安装", () => {
    expect(() => installArchiveBuffer(makePackZip(), { archiveUrl: "https://e/x.zip", sha256: "0".repeat(64) })).toThrow("SHA-256");
  });

  test("ZIP 条目路径越界 → 拒绝安装", () => {
    const zip = makePackZip("demo_pack", [{ name: "../evil.png", data: Buffer.from([1]) }]);
    expect(() =>
      installArchiveBuffer(zip, { archiveUrl: "https://e/x.zip", sha256: createHash("sha256").update(zip).digest("hex") }),
    ).toThrow("越界");
  });

  test("缺 index.db → 拒绝安装", () => {
    const zip = zipStore([{ name: "manifest.json", data: Buffer.from('{"id":"x"}') }]);
    expect(() =>
      installArchiveBuffer(zip, { archiveUrl: "https://e/x.zip", sha256: createHash("sha256").update(zip).digest("hex") }),
    ).toThrow("index.db");
  });

  test("离线：市场目录不可达时明确失败，但本地索引仍可读取", async () => {
    saveSettings({ remoteDirUrl: "https://127.0.0.1:1/catalog.json" });
    const market = await fetchMarketCatalog(true);
    expect(market.ok).toBe(false);
    expect(market.packs).toEqual([]);
    expect(market.warning).toContain("不可达");

    const local = indexPayload({ packId: "all", limit: 50 });
    expect(Array.isArray(local.memes)).toBe(true);
    expect(local.total).toBeGreaterThanOrEqual(0);
  });
});
