/**
 * tools 测试：registerCustomTools 注册矩阵 + 三个读类工具的 execute 行为。
 *
 * 用临时 MAXMA_PROJECT_ROOT 隔离数据源（memory.yaml / stickers / rules JSON）。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { registerCustomTools } from "../src/tools/index";
import { readMemories } from "../src/tools/memory";
import { listStickerCategories, pickSticker } from "../src/tools/stickers";
import { readAllRules } from "../src/tools/rules";

let root: string;
let originalRoot: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-tools-"));
  originalRoot = process.env.MAXMA_PROJECT_ROOT;
  process.env.MAXMA_PROJECT_ROOT = root;
});

afterEach(() => {
  if (originalRoot === undefined) delete process.env.MAXMA_PROJECT_ROOT;
  else process.env.MAXMA_PROJECT_ROOT = originalRoot;
  fs.rmSync(root, { recursive: true, force: true });
});

/** 写一个 memory.yaml（与 remember_memory 写入的格式一致）。 */
function writeMemoryYaml(entries: Record<string, unknown>): void {
  const dir = path.join(root, "config", "personas");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "memory.yaml"), JSON.stringify(entries), "utf8");
}

// ── 注册矩阵 ────────────────────────────────────────────────────────────────

describe("registerCustomTools", () => {
  test("registers 5 custom tools (write + 4 read)", () => {
    const tools = registerCustomTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("remember_memory");
    expect(names).toContain("search_memories");
    expect(names).toContain("get_sticker");
    expect(names).toContain("list_rules");
    expect(names).toContain("list_automations");
    expect(tools.length).toBe(5);
  });

  test("every tool uses a plain JSON Schema (no zod leakage)", () => {
    const tools = registerCustomTools();
    for (const t of tools) {
      const p = t.parameters as Record<string, unknown>;
      expect(p.type).toBe("object");
      expect(p).not.toHaveProperty("_def"); // zod 实例会带 _def 符号
      expect(p).not.toHaveProperty("~standard");
      expect(typeof p.properties).toBe("object");
    }
  });

  test("read tools are marked read-only approval", () => {
    const tools = registerCustomTools();
    for (const name of ["search_memories", "get_sticker", "list_rules"]) {
      const t = tools.find((x) => x.name === name);
      expect(t?.approval).toBe("read");
    }
    expect(tools.find((x) => x.name === "remember_memory")?.approval).toBe("write");
  });
});

// ── search_memories ──────────────────────────────────────────────────────────

describe("search_memories tool", () => {
  function buildTool() {
    return registerCustomTools().find((t) => t.name === "search_memories")!;
  }

  test("matches by keyword across descriptions", async () => {
    writeMemoryYaml({
      aaa11111: { description: "用户喜欢喝美式咖啡", theme: "偏好", latest_update_time: "2026-08-01 10:00:00" },
      bbb22222: { description: "用户在腾讯工作", theme: "身份", latest_update_time: "2026-08-02 11:00:00" },
    });
    const tool = buildTool();
    const res = await tool.execute("id", { query: "咖啡" });
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("美式咖啡");
    expect(text).not.toContain("腾讯");
    expect((res.details as { total?: number }).total).toBe(1);
  });

  test("filters by category", async () => {
    writeMemoryYaml({
      aaa11111: { description: "喜欢猫", theme: "偏好", latest_update_time: "2026-08-01 10:00:00" },
      bbb22222: { description: "有两只猫", theme: "事实", latest_update_time: "2026-08-02 11:00:00" },
    });
    const tool = buildTool();
    const res = await tool.execute("id", { category: "偏好" });
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("喜欢猫");
    expect(text).not.toContain("两只猫");
  });

  test("respects limit and sorts by update time desc", async () => {
    writeMemoryYaml({
      id1: { description: "记忆A", theme: "事实", latest_update_time: "2026-08-01 10:00:00" },
      id2: { description: "记忆B", theme: "事实", latest_update_time: "2026-08-03 10:00:00" },
      id3: { description: "记忆C", theme: "事实", latest_update_time: "2026-08-02 10:00:00" },
    });
    const tool = buildTool();
    const res = await tool.execute("id", { limit: 2 });
    const text = res.content[0]?.text ?? "";
    // B(08-03) 与 C(08-02) 最新
    expect(text.indexOf("记忆B")).toBeLessThan(text.indexOf("记忆C"));
    expect(text).not.toContain("记忆A");
    expect((res.details as { returned?: number }).returned).toBe(2);
  });

  test("empty memory file → clean empty result", async () => {
    const tool = buildTool();
    const res = await tool.execute("id", { query: "任何" });
    expect(res.content[0]?.text).toContain("没有找到");
    expect((res.details as { total?: number }).total).toBe(0);
  });

  test("readMemories tolerates a malformed YAML file", async () => {
    const dir = path.join(root, "config", "personas");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "memory.yaml"), "{{{ broken", "utf8");
    const memories = await readMemories();
    expect(memories).toEqual([]);
  });
});

// ── get_sticker ──────────────────────────────────────────────────────────────

describe("get_sticker tool", () => {
  function buildTool() {
    return registerCustomTools().find((t) => t.name === "get_sticker")!;
  }

  function seedStickers() {
    fs.mkdirSync(path.join(root, "config", "stickers", "开心"), { recursive: true });
    fs.mkdirSync(path.join(root, "config", "stickers", "委屈"), { recursive: true });
    fs.writeFileSync(path.join(root, "config", "stickers", "开心", "a.webp"), "x");
    fs.writeFileSync(path.join(root, "config", "stickers", "开心", "b.webp"), "x");
    fs.writeFileSync(path.join(root, "config", "stickers", "委屈", "c.webp"), "x");
    fs.writeFileSync(path.join(root, "config", "stickers", "委屈", "note.txt"), "ignored");
  }

  test("without category lists available categories", async () => {
    seedStickers();
    const tool = buildTool();
    const res = await tool.execute("id", {});
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("开心");
    expect(text).toContain("委屈");
    expect(text).toContain("2 张");
    expect((res.details as { categories?: Array<{ category: string; count: number }> }).categories?.length).toBe(2);
  });

  test("with category returns a valid sticker path", async () => {
    seedStickers();
    const tool = buildTool();
    const res = await tool.execute("id", { category: "开心" });
    const text = res.content[0]?.text ?? "";
    expect(text).toMatch(/贴纸：开心\/[ab]\.webp/);
    expect((res.details as { found?: boolean }).found).toBe(true);
  });

  test("unknown category → not found with guidance", async () => {
    seedStickers();
    const tool = buildTool();
    const res = await tool.execute("id", { category: "不存在" });
    expect(res.content[0]?.text).toContain("没有贴纸");
    expect((res.details as { found?: boolean }).found).toBe(false);
  });

  test("no stickers dir → empty categories", async () => {
    const tool = buildTool();
    const res = await tool.execute("id", {});
    expect(res.content[0]?.text).toContain("没有可用的贴纸");
  });

  test("listStickerCategories / pickSticker helpers", async () => {
    seedStickers();
    const cats = await listStickerCategories();
    expect(cats.find((c) => c.category === "开心")?.count).toBe(2);
    const picked = await pickSticker("开心");
    expect(picked).toMatch(/^开心\/[ab]\.webp$/);
    expect(await pickSticker("不存在")).toBeNull();
  });
});

// ── list_rules ───────────────────────────────────────────────────────────────

describe("list_rules tool", () => {
  function buildTool() {
    return registerCustomTools().find((t) => t.name === "list_rules")!;
  }

  function seedRules() {
    fs.mkdirSync(path.join(root, "config", "rules"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "config", "rules", "builtin_rules.json"),
      JSON.stringify([
        { id: "py-types", language: "python", name: "类型提示", description: "参数必须有类型注解", severity: "warning", enabled: true },
        { id: "ts-null", language: "typescript", name: "严格空检查", description: "禁止隐式 any", severity: "error", enabled: true },
        { id: "gen-magic", language: "general", name: "魔法数字", description: "提取命名常量", severity: "info", enabled: false },
      ]),
      "utf8",
    );
  }

  test("returns enabled rules with descriptions", async () => {
    seedRules();
    const tool = buildTool();
    const res = await tool.execute("id", {});
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("类型提示");
    expect(text).toContain("严格空检查");
    expect(text).not.toContain("魔法数字"); // disabled 不显示
    expect((res.details as { enabled?: number }).enabled).toBe(2);
  });

  test("filters by language", async () => {
    seedRules();
    const tool = buildTool();
    const res = await tool.execute("id", { language: "python" });
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("类型提示");
    expect(text).not.toContain("严格空检查");
  });

  test("filters by severity", async () => {
    seedRules();
    const tool = buildTool();
    const res = await tool.execute("id", { severity: "error" });
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("严格空检查");
    expect(text).not.toContain("类型提示");
  });

  test("missing rules file → clean empty result", async () => {
    const tool = buildTool();
    const res = await tool.execute("id", {});
    expect(res.content[0]?.text).toContain("没有启用的质量规则");
  });

  test("readAllRules merges user custom rules", async () => {
    seedRules();
    fs.mkdirSync(path.join(root, "api", "data"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "api", "data", "user_rules.json"),
      JSON.stringify([{ id: "custom-1", language: "go", name: "团队规范", description: "禁止裸 return", severity: "error", enabled: true }]),
      "utf8",
    );
    const rules = await readAllRules();
    expect(rules.length).toBe(4);
    expect(rules.find((r) => r.id === "custom-1")?.source).toBe("custom");
    expect(rules.find((r) => r.id === "py-types")?.source).toBe("builtin");
  });
});
