/**
 * tests/merge-memory.test.ts — 记忆合并与裁决留痕。
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { mergeMemoriesTool } from "../src/tools/merge-memory";
import { memoryFilePath } from "../src/tools/memory";
import { maxmaDataRoot } from "../src/kernel/project-paths";

const dirs: string[] = [];
const originalData = process.env.MAXMA_DATA_DIR;
const originalProject = process.env.MAXMA_PROJECT_ROOT;

function useTempRoots(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-merge-"));
  dirs.push(dir);
  process.env.MAXMA_DATA_DIR = dir;
  process.env.MAXMA_PROJECT_ROOT = dir;
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  if (originalData === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = originalData;
  if (originalProject === undefined) delete process.env.MAXMA_PROJECT_ROOT;
  else process.env.MAXMA_PROJECT_ROOT = originalProject;
});

const yaml = (globalThis as typeof globalThis & { Bun: { YAML: { stringify(value: unknown): string; parse(text: string): unknown } } }).Bun.YAML;

async function seedPersona(entries: Record<string, string>): Promise<void> {
  const file = memoryFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const doc: Record<string, unknown> = {};
  for (const [id, description] of Object.entries(entries)) {
    doc[id] = { description, theme: "偏好", latest_update_time: "2026-01-01 00:00:00", history: [] };
  }
  fs.writeFileSync(file, yaml.stringify(doc), "utf8");
}

describe("merge_memories", () => {
  test("persona 层合并：旧条目进 history，新条目落盘，裁决写日志", async () => {
    const dir = useTempRoots();
    await seedPersona({ a1: "喜欢蓝色", a2: "不喜欢蓝色" });
    const result = await mergeMemoriesTool().execute("call-1", {
      ids: ["a1", "a2"],
      content: "用户对蓝色的偏好已变化，以当前表述为准",
      reason: "两条互相矛盾，用户确认以最新表述为准",
    });
    expect(result.details).toMatchObject({ merged: true, scope: "persona" });
    const doc = yaml.parse(fs.readFileSync(memoryFilePath(), "utf8")) as Record<string, Record<string, unknown>>;
    expect(Object.keys(doc)).toHaveLength(1);
    const entry = Object.values(doc)[0]!;
    expect(entry.description).toBe("用户对蓝色的偏好已变化，以当前表述为准");
    expect(Array.isArray(entry.history)).toBe(true);
    const conflictLog = fs.readFileSync(path.join(dir, "memory", "conflicts.jsonl"), "utf8");
    expect(conflictLog).toContain("两条互相矛盾");
    expect(conflictLog).toContain('"action":"merge"');
  });

  test("project 层合并只动指定项目文件", async () => {
    const dir = useTempRoots();
    const file = path.join(dir, "memory", "projects", "demo.yaml");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, yaml.stringify({
      p1: { description: "构建用 bun", theme: "事实", latest_update_time: "" },
      p2: { description: "构建用 npm", theme: "事实", latest_update_time: "" },
    }), "utf8");
    const result = await mergeMemoriesTool().execute("call-2", {
      ids: ["p1", "p2"],
      scope: "project",
      key: "demo",
      content: "构建统一用 bun",
      reason: "旧信息已过期",
    });
    expect(result.details).toMatchObject({ merged: true, scope: "project", key: "demo" });
    const doc = yaml.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(Object.keys(doc)).toHaveLength(1);
    expect(maxmaDataRoot()).toBe(dir);
  });

  test("id 不存在整次拒绝；缺 reason 拒绝", async () => {
    useTempRoots();
    await seedPersona({ only: "唯一一条" });
    const missing = await mergeMemoriesTool().execute("call-3", { ids: ["only", "ghost"], reason: "x" });
    expect(missing.details).toMatchObject({ merged: false, reason: "missing_ids" });
    const noReason = await mergeMemoriesTool().execute("call-4", { ids: ["only", "only2"], reason: "" });
    expect(noReason.details).toMatchObject({ merged: false, reason: "missing_reason" });
  });
});
