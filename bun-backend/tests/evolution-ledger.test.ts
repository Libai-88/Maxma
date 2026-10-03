import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

let dataDir = "";
let previousDataDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join("D:\\MaxmaTemp", "maxma-evolution-"));
  previousDataDir = process.env.MAXMA_DATA_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
});

afterEach(async () => {
  const { resetDbInitForTest } = await import("../src/db/core");
  resetDbInitForTest();
  if (previousDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("EvoCore behavior ledger", () => {
  test("learns explicit preferences and injects only matching compact context", async () => {
    const evolution = await import("../src/evolution-ledger");
    const rule = evolution.learnFromUserMessage("以后回答代码时先给出最小可运行示例", "session-1", "turn-1");
    expect(rule?.status).toBe("active");
    expect(rule?.source).toBe("explicit_user");

    const matching = evolution.getEvolutionContext("请帮我修改这段代码");
    expect(matching).toContain("最小可运行示例");
    expect(evolution.getEvolutionContext("今天天气怎么样")).toBe("");

    const stats = evolution.evolutionStats();
    expect(stats.active).toBe(1);
    expect(stats.total).toBe(1);
  });

  test("supports reversible negative feedback without storing the original prompt", async () => {
    const evolution = await import("../src/evolution-ledger");
    const rule = evolution.learnFromUserMessage("请记住我喜欢简洁的列表", "session-2", "turn-2");
    if (!rule) throw new Error("expected a learned rule");
    const updated = evolution.recordEvolutionFeedback(rule.id, "negative");
    expect(updated?.negative_count).toBe(1);
    expect(updated?.confidence).toBeLessThan(rule.confidence);
    const listed = evolution.listEvolutionRules();
    expect(listed[0]?.rule_text).toContain("简洁的列表");
    expect(listed[0]?.rule_text).not.toContain("请记住");
  });
});
