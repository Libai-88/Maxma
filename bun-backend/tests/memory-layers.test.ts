/**
 * tests/memory-layers.test.ts — MEM-1 三层存储、导出/导入与裁决记录。
 *
 * 这里锁的是"数据真的分三层、迁移真的能往返"，不是路由存在。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createMemoryRoutes } from "../src/routes/memory";

let dataDir = "";
const originalDataDir = process.env.MAXMA_DATA_DIR;

function app() {
  return createMemoryRoutes();
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-memory-"));
  process.env.MAXMA_DATA_DIR = dataDir;
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = originalDataDir;
});

describe("三层记忆", () => {
  test("persona / project / session 分文件保存，按 scope 读取", async () => {
    const routes = app();
    const persona = await routes.request("/api/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "用户喜欢简洁界面", category: "偏好" }),
    });
    expect(persona.status).toBe(201);

    const project = await routes.request("/api/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "project", key: "maxma", content: "Maxma 使用 Bun", category: "事实" }),
    });
    expect(project.status).toBe(201);

    const session = await routes.request("/api/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "session", key: "s-1", content: "今天修了路径策略", category: "事件" }),
    });
    expect(session.status).toBe(201);

    const all = await (await routes.request("/api/memory?scope=all")).json() as Array<{ content: string; scope: string }>;
    expect(all.map((fact) => fact.scope).sort()).toEqual(["persona", "project", "session"]);

    const projectOnly = await (await routes.request("/api/memory?scope=project")).json() as Array<{ content: string; source: string }>;
    expect(projectOnly).toHaveLength(1);
    expect(projectOnly[0]!.content).toBe("Maxma 使用 Bun");
    expect(projectOnly[0]!.source).toBe("maxma");

    expect(fs.existsSync(path.join(dataDir, "config", "personas", "memory.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, "memory", "projects", "maxma.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, "memory", "sessions", "s-1.jsonl"))).toBe(true);
  });

  test("非法 key 被拒绝，不拼路径", async () => {
    const routes = app();
    const response = await routes.request("/api/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "project", key: "../escape", content: "x" }),
    });
    expect(response.status).toBe(400);
    expect(fs.existsSync(path.join(dataDir, "memory", "projects", "..", "escape.yaml"))).toBe(false);
  });

  test("stats 带三层计数", async () => {
    const routes = app();
    await routes.request("/api/memory", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "a" }),
    });
    await routes.request("/api/memory", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "project", key: "p", content: "b" }),
    });
    const stats = await (await routes.request("/api/memory/stats?scope=all")).json() as {
      total: number; scopes: Record<string, number>
    };
    expect(stats.total).toBe(2);
    expect(stats.scopes).toEqual({ persona: 1, project: 1, session: 0 });
  });
});

describe("导出 / 导入", () => {
  test("导出包含三层；导入到空数据目录后能读回", async () => {
    const routes = app();
    await routes.request("/api/memory", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "人格记忆 A" }),
    });
    await routes.request("/api/memory", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "project", key: "demo", content: "项目记忆 B" }),
    });
    await routes.request("/api/memory", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "session", key: "s1", content: "会话事件 C" }),
    });
    const bundle = await (await routes.request("/api/memory/export")).json() as Record<string, unknown>;
    expect(Object.keys(bundle.persona as object).length).toBe(1);
    expect(Object.keys(bundle.projects as object)).toEqual(["demo"]);
    expect(Object.keys(bundle.sessions as object)).toEqual(["s1"]);

    const other = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-memory-import-"));
    process.env.MAXMA_DATA_DIR = other;
    try {
      const routes2 = app();
      const imported = await routes2.request("/api/memory/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bundle, mode: "merge" }),
      });
      expect(imported.status).toBe(200);
      const facts = await (await routes2.request("/api/memory?scope=all")).json() as Array<{ content: string }>;
      expect(facts.map((fact) => fact.content).sort()).toEqual(["人格记忆 A", "会话事件 C", "项目记忆 B"]);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  test("坏包整批拒绝", async () => {
    const routes = app();
    const bad = await routes.request("/api/memory/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bundle: { version: 9 }, mode: "merge" }),
    });
    expect(bad.status).toBe(400);
  });

  test("裁决记录可写可读", async () => {
    const routes = app();
    const record = await routes.request("/api/memory/conflicts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: ["a", "b"], kept: "a", reason: "b 过时" }),
    });
    expect(record.status).toBe(200);
    const list = await (await routes.request("/api/memory/conflicts")).json() as Array<{ action: string; kept: string }>;
    expect(list.at(-1)!.action).toBe("resolve");
    expect(list.at(-1)!.kept).toBe("a");
    expect(fs.existsSync(path.join(dataDir, "memory", "conflicts.jsonl"))).toBe(true);
  });
});
