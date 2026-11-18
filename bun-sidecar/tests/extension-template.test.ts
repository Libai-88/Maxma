/**
 * tests/extension-template.test.ts — 脚手架模板的"能真的加载"契约。
 *
 * 这条守卫的存在理由：模板是字符串，写成什么样都能过 tsc；
 * 唯一可靠的检查是——渲染到磁盘 → 动态 import → 用假 pi 收集注册结果 →
 * 真的执行一次工具。这样模板与 pi 1.5.0 的契约脱节时会立刻变红。
 */

import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import {
  isValidExtensionName,
  renderExtensionReadme,
  renderExtensionScaffold,
  toolNameFor,
} from "../src/kernel/extension-template";

// 临时目录必须留在 bun-sidecar/tests 下：生成的文件要 import "typebox" 与 pi 包，
// 放在系统临时目录会让模块解析往上找不到 node_modules（那是环境问题，不是模板问题）。
const TMP_ROOT = fs.mkdtempSync(path.join(import.meta.dir, ".tmp-ext-template-"));

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("kernel: extension template", () => {
  test("名字校验：拒绝大写、下划线、单字符、超长与穿越", () => {
    for (const good of ["hello-tools", "ab", "repo-onboarding", "a1-b2"]) {
      expect(isValidExtensionName(good)).toBe(true);
    }
    for (const bad of ["Hello", "hello_tools", "a", "-bad", "bad-", "a--b", "../evil", "", "a".repeat(33)]) {
      expect(isValidExtensionName(bad)).toBe(false);
    }
  });

  test("工具名由目录名派生为 snake_case，且以 _hello 结尾", () => {
    expect(toolNameFor("hello-tools")).toBe("hello_tools_hello");
    expect(/^[a-z][a-z0-9_]*$/.test(toolNameFor("repo-onboarding"))).toBe(true);
  });

  test("非法名字在渲染阶段就抛错（不给调用方写盘的机会）", () => {
    expect(() => renderExtensionScaffold({ name: "../evil" })).toThrow(/不合法/);
  });

  test("渲染出的扩展能被 import，并注册一个可执行的工具与一个命令", async () => {
    const name = "hello-tools";
    const dir = path.join(TMP_ROOT, name);
    const files = renderExtensionScaffold({ name, dir });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.ts"), files.index, "utf8");
    fs.writeFileSync(path.join(dir, "README.md"), files.readme, "utf8");

    const mod = (await import(pathToFileURL(path.join(dir, "index.ts")).href)) as {
      default?: unknown;
    };
    expect(typeof mod.default).toBe("function");

    const tools: Array<Record<string, unknown>> = [];
    const commands: Array<Record<string, unknown>> = [];
    const fakePi = {
      registerTool: (tool: Record<string, unknown>) => tools.push(tool),
      registerCommand: (cmdName: string, options: Record<string, unknown>) =>
        commands.push({ name: cmdName, ...options }),
      on: () => () => {},
    };
    await (mod.default as (pi: unknown) => Promise<void>)(fakePi);

    expect(tools).toHaveLength(1);
    const tool = tools[0]!;
    expect(tool.name).toBe("hello_tools_hello");
    expect(String(tool.description)).toContain("问候");
    expect((tool.parameters as { type?: string }).type).toBe("object");

    const execute = tool.execute as (id: string, params: Record<string, unknown>) => Promise<{
      content: Array<{ type: string; text: string }>;
      details: Record<string, unknown>;
    }>;
    const result = await execute("call-1", { who: "爸爸" });
    expect(result.content[0]!.type).toBe("text");
    expect(result.content[0]!.text).toContain("爸爸");
    expect(result.details.who).toBe("爸爸");

    // 空参数回退到 world，保证示例工具在任何输入下都不崩。
    const fallback = await execute("call-2", {});
    expect(fallback.details.who).toBe("world");

    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe(name);
    const notified: Array<[string, string | undefined]> = [];
    await (commands[0]!.handler as (args: string, ctx: unknown) => Promise<void>)("", {
      ui: { notify: (message: string, type?: string) => notified.push([message, type]) },
    });
    expect(notified[0]?.[0]).toContain(name);
    expect(notified[0]?.[1]).toBe("info");
  });

  test("README 指向真实工具名与命令，避免生成完不知道下一步", () => {
    const readme = renderExtensionReadme({ name: "meeting-notes" });
    expect(readme).toContain("meeting_notes_hello");
    expect(readme).toContain("/meeting-notes");
    expect(readme).toContain("重新探测");
  });
});
