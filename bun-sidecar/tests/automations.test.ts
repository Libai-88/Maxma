/**
 * list_automations 工具测试：用临时 SQLite 库模拟后端 automations 表。
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { registerCustomTools } from "../src/tools/index";
import { readAutomations } from "../src/tools/automations";

let root: string;
let originalRoot: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-auto-"));
  originalRoot = process.env.MAXMA_PROJECT_ROOT;
  process.env.MAXMA_PROJECT_ROOT = root;
});

afterEach(() => {
  if (originalRoot === undefined) delete process.env.MAXMA_PROJECT_ROOT;
  else process.env.MAXMA_PROJECT_ROOT = originalRoot;
  fs.rmSync(root, { recursive: true, force: true });
});

/** 建一个带 automations 表的临时 SQLite（结构与后端一致）。 */
function seedDb(rows: Array<Record<string, unknown>>): void {
  const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
  const dir = path.join(root, "api", "data");
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, "maxma.db"));
  db.run(`CREATE TABLE automations (
    id TEXT PRIMARY KEY, name TEXT, description TEXT, cron_expr TEXT,
    interval_seconds INTEGER, action TEXT, enabled INTEGER,
    last_run TEXT, next_run TEXT, run_count INTEGER, created_at TEXT
  )`);
  for (const r of rows) {
    db.run(
      `INSERT INTO automations (id, name, description, cron_expr, interval_seconds, action, enabled, last_run, next_run, run_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r.id, r.name, r.description, r.cron_expr ?? null, r.interval_seconds ?? null,
      r.action, r.enabled ? 1 : 0, r.last_run ?? null, r.next_run ?? null, r.run_count ?? 0, "2026-08-08T00:00:00",
    );
  }
  db.close();
}

function buildTool() {
  return registerCustomTools().find((t) => t.name === "list_automations")!;
}

describe("list_automations tool", () => {
  test("registers as a read-only tool with plain JSON schema", () => {
    const tools = registerCustomTools();
    const t = tools.find((x) => x.name === "list_automations");
    expect(t).toBeDefined();
    expect(t?.approval).toBe("read");
    expect((t?.parameters as Record<string, unknown>).type).toBe("object");
  });

  test("lists automation tasks with schedule and action summary", async () => {
    seedDb([
      {
        id: "auto-1", name: "每日报告", description: "生成每日摘要",
        cron_expr: "0 9 * * *", action: JSON.stringify({ type: "prompt", payload: { text: "生成今日工作报告" } }),
        enabled: true, run_count: 12, last_run: "2026-08-07T09:00:00", next_run: "2026-08-08T09:00:00",
      },
      {
        id: "auto-2", name: "日志清理", description: "清理旧日志",
        interval_seconds: 3600, action: JSON.stringify({ type: "noop", payload: {} }),
        enabled: false, run_count: 0,
      },
    ]);
    const tool = buildTool();
    const res = await tool.execute("id", {});
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("每日报告");
    expect(text).toContain("cron:0 9 * * *");
    expect(text).toContain("已运行 12 次");
    expect(text).toContain("生成今日工作报告");
    expect(text).toContain("日志清理");
    expect(text).toContain("every 3600s");
    expect((res.details as { total?: number }).total).toBe(2);
  });

  test("filters by name keyword", async () => {
    seedDb([
      { id: "a1", name: "报告生成", description: "", action: "{}", enabled: true, run_count: 0 },
      { id: "a2", name: "备份任务", description: "", action: "{}", enabled: true, run_count: 0 },
    ]);
    const tool = buildTool();
    const res = await tool.execute("id", { name: "报告" });
    const text = res.content[0]?.text ?? "";
    expect(text).toContain("报告生成");
    expect(text).not.toContain("备份任务");
  });

  test("missing db → clean empty result", async () => {
    const tool = buildTool();
    const res = await tool.execute("id", {});
    expect(res.content[0]?.text).toContain("没有匹配的自动化任务");
    expect((res.details as { total?: number }).total).toBe(0);
  });

  test("corrupted action JSON degrades gracefully", async () => {
    seedDb([
      { id: "a1", name: "坏动作", description: "", action: "{{{ not json", enabled: true, run_count: 3 },
    ]);
    const automations = await readAutomations();
    expect(automations.length).toBe(1);
    expect(automations[0]?.actionSummary).toBe("");
  });
});
