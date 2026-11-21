/**
 * tests/hooks.test.ts — A4 钩子：签名、处理器与 pi 生命周期接线。
 *
 * 这里锁三类"会静默骗人的事"：
 *   1. 没签名的配置被当成可用（unsigned hooks never run）；
 *   2. 钩子说 block，扩展却把工具放过去；
 *   3. 坏钩子把整个工作台拖死（fail-open，且有审计）。
 */

import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { computeHooksSignature, ensureHooksSecret, hooksConfigPath, hooksSecretPath, loadHooksConfig } from "../src/kernel/hooks/config";
import { runHooks } from "../src/kernel/hooks/runner";
import { createMaxmaHooksExtension } from "../src/kernel/extensions/maxma-hooks";
import type { HookDefinition, HooksConfigFile } from "../src/kernel/hooks/hook-types";

const cleanup: string[] = [];
const originalDataDir = process.env.MAXMA_DATA_DIR;
const originalHooksFile = process.env.MAXMA_HOOKS_FILE;

function useTempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-hooks-"));
  cleanup.push(dir);
  process.env.MAXMA_DATA_DIR = dir;
  delete process.env.MAXMA_HOOKS_FILE;
  return dir;
}

function writeSignedConfig(dir: string, hooks: HookDefinition[]): void {
  const file = path.join(dir, "config", "hooks.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const secret = ensureHooksSecret(dir);
  const config: HooksConfigFile = {
    version: 1,
    hooks,
    signature: computeHooksSignature({ version: 1, hooks }, secret),
  };
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

afterEach(() => {
  for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.MAXMA_DATA_DIR;
  else process.env.MAXMA_DATA_DIR = originalDataDir;
  if (originalHooksFile === undefined) delete process.env.MAXMA_HOOKS_FILE;
  else process.env.MAXMA_HOOKS_FILE = originalHooksFile;
});

describe("钩子配置：签名是硬门槛", () => {
  test("没有配置 → absent，不报错", () => {
    const dir = useTempDataDir();
    const loaded = loadHooksConfig(dir);
    expect(loaded.status).toBe("absent");
    expect(loaded.hooks).toEqual([]);
    expect(loaded.errors).toEqual([]);
    expect(hooksConfigPath(dir)).toContain("hooks.json");
  });

  test("有配置但没签名 → 整份不加载", () => {
    const dir = useTempDataDir();
    const file = path.join(dir, "config", "hooks.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      version: 1,
      hooks: [{ id: "x", events: ["PreToolUse"], handler: { type: "prompt", text: "no" } }],
    }), "utf8");
    const loaded = loadHooksConfig(dir);
    expect(loaded.status).toBe("invalid");
    expect(loaded.hooks).toEqual([]);
    expect(loaded.errors.join("")).toContain("整份钩子不加载");
  });

  test("签名后可用；改一个字段就失效", () => {
    const dir = useTempDataDir();
    const hooks: HookDefinition[] = [
      { id: "deny-write", events: ["PreToolUse"], matcher: "write", handler: { type: "prompt", text: "不要写" } },
    ];
    writeSignedConfig(dir, hooks);
    expect(loadHooksConfig(dir).status).toBe("ready");
    expect(loadHooksConfig(dir).hooks).toHaveLength(1);

    const file = hooksConfigPath(dir);
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as HooksConfigFile;
    parsed.hooks[0]!.matcher = "bash";
    fs.writeFileSync(file, JSON.stringify(parsed), "utf8");
    const tampered = loadHooksConfig(dir);
    expect(tampered.status).toBe("invalid");
    expect(tampered.hooks).toEqual([]);
    expect(tampered.errors.join("")).toContain("签名不匹配");
    expect(hooksSecretPath(dir)).toContain("hooks.secret");
  });

  test("签名正确但某条结构非法 → 跳过该条，其余仍可运行", () => {
    const dir = useTempDataDir();
    writeSignedConfig(dir, [
      { id: "bad", events: ["PreToolUse"], handler: { type: "command", command: "", args: [] } as never },
      { id: "good", events: ["SessionStart"], handler: { type: "prompt", text: "hello" } },
    ]);
    // writeSignedConfig 签的是原数组；结构校验发生在加载时，不会让签名失效。
    const loaded = loadHooksConfig(dir);
    expect(loaded.status).toBe("ready");
    expect(loaded.hooks.map((h) => h.id)).toEqual(["good"]);
    expect(loaded.errors.join("")).toContain("缺少 command");
  });
});

describe("钩子处理器", () => {
  test("command handler：stdin 收 payload，stdout JSON 决策可 block 并改写入参", async () => {
    const dir = useTempDataDir();
    const script = path.join(dir, "hook.mjs");
    fs.writeFileSync(script, `
let body = "";
process.stdin.on("data", (chunk) => { body += chunk; });
process.stdin.on("end", () => {
  const payload = JSON.parse(body);
  console.log(JSON.stringify({
    decision: payload.input?.path === "secret.txt" ? "block" : "allow",
    reason: "路径不允许",
    inputPatch: { path: "safe.txt" },
  }));
});
`, "utf8");
    const hooks: HookDefinition[] = [{
      id: "guard",
      events: ["PreToolUse"],
      matcher: "read",
      handler: { type: "command", command: process.execPath, args: [script], timeoutMs: 8_000 },
    }];

    const blocked = await runHooks(hooks, {
      event: "PreToolUse",
      sessionId: "s",
      cwd: dir,
      toolName: "read",
      input: { path: "secret.txt" },
    });
    expect(blocked.decision.block).toBe(true);
    expect(blocked.decision.reason).toContain("路径不允许");
    expect(blocked.records[0]!.status).toBe("ok");

    const allowed = await runHooks(hooks, {
      event: "PreToolUse",
      sessionId: "s",
      cwd: dir,
      toolName: "read",
      input: { path: "ok.txt" },
    });
    expect(allowed.decision.block).toBeUndefined();
    expect(allowed.decision.inputPatch).toEqual({ path: "safe.txt" });
  }, 20_000);

  test("command 失败 fail-open：不阻断工具，但记录 error", async () => {
    const dir = useTempDataDir();
    const hooks: HookDefinition[] = [{
      id: "broken",
      events: ["PreToolUse"],
      handler: { type: "command", command: process.execPath, args: ["-e", "process.exit(3)"], timeoutMs: 5_000 },
    }];
    const run = await runHooks(hooks, {
      event: "PreToolUse",
      sessionId: "s",
      cwd: dir,
      toolName: "read",
      input: { path: "x" },
    });
    expect(run.decision.block).toBeUndefined();
    expect(run.records[0]!.status).toBe("error");
    expect(run.records[0]!.error).toContain("退出码 3");
  }, 20_000);

  test("http handler：POST payload，返回 JSON 决策", async () => {
    const seen: unknown[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = await request.json();
        seen.push(body);
        return Response.json({ contentAppend: "钩子补充：文件已读" });
      },
    });
    const hooks: HookDefinition[] = [{
      id: "http-post",
      events: ["PostToolUse"],
      matcher: "read",
      handler: { type: "http", url: `http://127.0.0.1:${server.port}/hook`, timeoutMs: 5_000 },
    }];
    try {
      const run = await runHooks(hooks, {
        event: "PostToolUse",
        sessionId: "s",
        cwd: process.cwd(),
        toolName: "read",
        input: { path: "a.txt" },
        result: { isError: false, text: "内容" },
      });
      expect(run.decision.contentAppend).toContain("钩子补充");
      expect(seen).toHaveLength(1);
    } finally {
      server.stop(true);
    }
  }, 20_000);

  test("prompt handler：PreToolUse 当拒绝原因，SessionStart 当附加上下文", async () => {
    const hooks: HookDefinition[] = [
      { id: "p1", events: ["PreToolUse", "SessionStart"], handler: { type: "prompt", text: "记住：不要碰生产库" } },
    ];
    const pre = await runHooks(hooks, {
      event: "PreToolUse",
      sessionId: "s",
      cwd: process.cwd(),
      toolName: "bash",
      input: { command: "rm" },
    });
    expect(pre.decision.block).toBe(true);
    expect(pre.decision.reason).toContain("生产库");

    const start = await runHooks(hooks, {
      event: "SessionStart",
      sessionId: "s",
      cwd: process.cwd(),
    });
    expect(start.decision.additionalContext).toContain("不要碰生产库");
  });

  test("matcher 不命中时不执行处理器", async () => {
    const hooks: HookDefinition[] = [{
      id: "only-bash",
      events: ["PreToolUse"],
      matcher: "bash",
      handler: {
        type: "command",
        command: process.execPath,
        args: ["-e", "process.exit(9)"],
      },
    }];
    const run = await runHooks(hooks, {
      event: "PreToolUse",
      sessionId: "s",
      cwd: process.cwd(),
      toolName: "read",
      input: {},
    });
    expect(run.records).toEqual([]);
  });
});

describe("pi 生命周期接线", () => {
  test("tool_call 被钩子阻断、tool_result 追加文本、session_start 注入消息", async () => {
    const handlers: Record<string, (event: unknown) => Promise<unknown> | unknown> = {};
    const messages: Array<{ customType: string; content: unknown }> = [];
    const extension = createMaxmaHooksExtension({
      sessionId: "s-hooks",
      cwd: process.cwd(),
      hooks: [
        { id: "block", events: ["PreToolUse"], matcher: "write", handler: { type: "prompt", text: "写入被钩子拒绝" } },
        { id: "post", events: ["PostToolUse"], matcher: "read", handler: { type: "prompt", text: "阅读完成" } },
        { id: "start", events: ["SessionStart"], handler: { type: "prompt", text: "会话开始提醒" } },
      ],
    });
    extension.factory({
      on(name: string, handler: (event: unknown) => Promise<unknown> | unknown) {
        handlers[name] = handler;
        return () => {};
      },
      sendMessage(message: { customType: string; content: unknown }) {
        messages.push(message);
      },
    } as never);

    const blocked = await handlers.tool_call!({ toolName: "write", toolCallId: "1", input: { path: "a" } });
    expect(blocked).toEqual({ block: true, reason: "写入被钩子拒绝" });

    const appended = await handlers.tool_result!({
      toolName: "read",
      toolCallId: "2",
      input: { path: "a" },
      content: [{ type: "text", text: "原文" }],
      isError: false,
    }) as { content: Array<{ text: string }> };
    expect(appended.content.map((block) => block.text).join("")).toContain("阅读完成");

    await handlers.session_start!({ reason: "startup" });
    expect(messages[0]!.customType).toBe("maxma-hook-context");
    expect(messages[0]!.content).toBe("会话开始提醒");
  });

  test("PreCompact 可以取消压缩并追加指令", async () => {
    const handlers: Record<string, (event: unknown) => Promise<unknown> | unknown> = {};
    const extension = createMaxmaHooksExtension({
      sessionId: "s-compact",
      cwd: process.cwd(),
      hooks: [{ id: "compact", events: ["PreCompact"], handler: { type: "prompt", text: "保留所有决策" } }],
    });
    extension.factory({
      on(name: string, handler: (event: unknown) => Promise<unknown> | unknown) {
        handlers[name] = handler;
        return () => {};
      },
    } as never);
    const event = { reason: "manual", willRetry: false, customInstructions: "旧指令" };
    const result = await handlers.session_before_compact!(event) as { cancel?: boolean };
    expect(result?.cancel).toBeUndefined();
    expect(event.customInstructions).toContain("保留所有决策");
  });
});
