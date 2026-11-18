/**
 * tests/extensions-scaffold.test.ts — 「新建扩展」接口的契约。
 *
 * 验证四件事：非法名字被拒（含路径穿越）、写盘内容与模板一致、同名冲突 409、
 * 写盘后立即探测（返回结果里有这次创建的信息，界面据此提示下一步）。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { authHeaderFor } from "./_helpers/auth";
import { resetExtensionsSnapshotForTests } from "../../bun-sidecar/src/kernel/extensions";

let dataDir = "";
let agentDir = "";
let prevDataDir: string | undefined;
let prevAgentDir: string | undefined;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-scaffold-data-"));
  // 放在 tests 目录下：生成的 index.ts 要 import typebox 与 pi 包，
  // 从系统临时目录解析不到 node_modules（那是环境问题，不是接口缺陷）。
  agentDir = fs.mkdtempSync(path.join(import.meta.dir, ".tmp-scaffold-agent-"));
  prevDataDir = process.env.MAXMA_DATA_DIR;
  prevAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.MAXMA_DATA_DIR = dataDir;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  fs.mkdirSync(path.join(dataDir, "api", "data"), { recursive: true });
  resetExtensionsSnapshotForTests();
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = prevDataDir;
  if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(agentDir, { recursive: true, force: true });
});

async function makeApp() {
  const { createApp } = await import("../src/server");
  return createApp();
}

function post(app: unknown, body: unknown) {
  return (app as { request: (url: string, init: RequestInit) => Promise<Response> }).request(
    "/api/extensions/scaffold",
    {
      method: "POST",
      headers: { ...authHeaderFor(dataDir), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/extensions/scaffold", () => {
  test("非法名字 → 400，且不落下任何目录", async () => {
    const app = await makeApp();
    for (const name of ["../evil", "Hello", "a", "hello_tools", "a".repeat(33)]) {
      const res = await post(app, { name });
      expect(res.status).toBe(400);
    }
    expect(fs.readdirSync(agentDir)).toEqual([]);
  });

  test("非 JSON → 400", async () => {
    const app = await makeApp();
    const res = await (app as { request: (u: string, i: RequestInit) => Promise<Response> }).request(
      "/api/extensions/scaffold",
      {
        method: "POST",
        headers: { ...authHeaderFor(dataDir), "Content-Type": "text/plain" },
        body: "hello",
      },
    );
    expect(res.status).toBe(400);
  });

  test("合法名字 → 200：写出 index.ts 与 README，并返回工具/命令名", async () => {
    const app = await makeApp();
    const res = await post(app, { name: "hello-tools" });
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown> & {
      created: { id: string; dir: string; tool_name: string; command: string };
    };
    expect(body.created.id).toBe("hello-tools/index.ts");
    expect(body.created.tool_name).toBe("hello_tools_hello");
    expect(body.created.command).toBe("hello-tools");

    const dir = path.join(agentDir, "extensions", "hello-tools");
    expect(fs.existsSync(path.join(dir, "index.ts"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "README.md"))).toBe(true);
    const index = fs.readFileSync(path.join(dir, "index.ts"), "utf8");
    expect(index).toContain("export default function");
    expect(index).toContain("hello_tools_hello");
    expect(index).toContain('registerCommand("hello-tools"');

    // 写盘 ≠ 生效：接口必须已经重新探测过，界面才能看到真实加载结果。
    expect(body.loaded).toBe(true);
    expect(Array.isArray(body.extensions)).toBe(true);
    const ids = (body.extensions as Array<{ id: string }>).map((e) => e.id);
    expect(ids).toContain("hello-tools/index.ts");
    // 模板本身必须能加载：一旦 pi 契约变化，这条会红。
    expect(body.errors).toEqual([]);
  });

  test("同名已存在 → 409，不覆盖已有代码", async () => {
    const app = await makeApp();
    expect((await post(app, { name: "hello-tools" })).status).toBe(200);
    const dir = path.join(agentDir, "extensions", "hello-tools");
    fs.writeFileSync(path.join(dir, "index.ts"), "// 用户自己改过\n", "utf8");

    const res = await post(app, { name: "hello-tools" });
    expect(res.status).toBe(409);
    expect(fs.readFileSync(path.join(dir, "index.ts"), "utf8")).toBe("// 用户自己改过\n");
  });
});
