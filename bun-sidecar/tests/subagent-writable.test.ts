/**
 * tests/subagent-writable.test.ts — A1：writable 子 Agent 的隔离 worktree 与 patch 返回。
 *
 * 证明的是行为而不是实现细节：
 *   - 子会话的 cwd 不是父仓库，而是独立 worktree；
 *   - 写工具只在 writable=true 时进入工具白名单；
 *   - 子会话写的文件不会被直接落到父仓库，只以 patch 形式回传；
 *   - worktree 在任务结束后被清理；
 *   - 非 git 仓库明确失败，而不是偷偷在父目录里写。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { SUBAGENT_WRITABLE_TOOL_NAMES, createSubagentTool } from "../src/kernel/subagent";

let repo = "";
let worktrees = "";

function git(args: string[], cwd: string): void {
  const result = Bun.spawnSync(["git", "-c", "user.email=test@maxma.local", "-c", "user.name=Maxma Test", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-subagent-repo-"));
  worktrees = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-subagent-wt-"));
  const previous = process.env.MAXMA_SUBAGENT_WORKTREES;
  process.env.MAXMA_SUBAGENT_WORKTREES = worktrees;
  fs.writeFileSync(path.join(repo, "base.txt"), "base\n", "utf8");
  git(["init", "-q"], repo);
  git(["add", "base.txt"], repo);
  git(["commit", "-q", "-m", "init"], repo);
  if (previous === undefined) delete process.env.MAXMA_SUBAGENT_WORKTREES;
  else process.env.MAXMA_SUBAGENT_WORKTREES = previous;
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(worktrees, { recursive: true, force: true });
});

interface Captured {
  cwd?: string;
  tools?: readonly string[];
}

function fakeSession(captured: Captured, edit: boolean): unknown {
  return {
    messages: [{ role: "assistant", content: edit ? "已写文件" : "只读完成" }],
    async prompt() {
      if (edit && captured.cwd) fs.writeFileSync(path.join(captured.cwd, "new.txt"), "from child\n", "utf8");
    },
    async abort() {},
    dispose() {},
  };
}

describe("writable subagent", () => {
  test("隔离 worktree：子会话写入不落父仓库，patch 回传，worktree 清理", async () => {
    const previous = process.env.MAXMA_SUBAGENT_WORKTREES;
    process.env.MAXMA_SUBAGENT_WORKTREES = worktrees;
    try {
      const captured: Captured = {};
      const tool = createSubagentTool({
        cwd: repo,
        limits: { maxConcurrent: 1, timeoutMs: 5_000 },
        createSession: async (options) => {
          captured.cwd = options.cwd;
          captured.tools = options.tools;
          return fakeSession(captured, true) as never;
        },
      });
      const result = await (tool as { execute: (id: string, params: unknown) => Promise<{ content: Array<{ text: string }>; details: Record<string, unknown> }> })
        .execute("call-w", { tasks: [{ prompt: "写一个文件", label: "w" }], writable: true });
      const task = (result.details as { tasks: Array<{ ok: boolean; patch?: string; isolatedWorktree?: boolean; error?: string }> }).tasks[0]!;
      expect(task.ok).toBe(true);
      expect(task.isolatedWorktree).toBe(true);
      expect(task.patch).toContain("new.txt");
      expect(fs.existsSync(path.join(repo, "new.txt"))).toBe(false);
      expect(captured.cwd).not.toBe(repo);
      expect(captured.cwd?.startsWith(worktrees)).toBe(true);
      expect(captured.tools).toEqual([...SUBAGENT_WRITABLE_TOOL_NAMES]);
      expect(fs.existsSync(captured.cwd ?? "")).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.MAXMA_SUBAGENT_WORKTREES;
      else process.env.MAXMA_SUBAGENT_WORKTREES = previous;
    }
  });

  test("writable=false 仍只读，不创建 worktree", async () => {
    let called = false;
    const captured: Captured = {};
    const tool = createSubagentTool({
      cwd: repo,
      limits: { maxConcurrent: 1, timeoutMs: 5_000 },
      createSession: async (options) => {
        called = true;
        captured.cwd = options.cwd;
        captured.tools = options.tools;
        return fakeSession(captured, false) as never;
      },
    });
    const result = await (tool as { execute: (id: string, params: unknown) => Promise<{ details: Record<string, unknown> }> })
      .execute("call-ro", { tasks: [{ prompt: "只读" }] });
    expect(called).toBe(true);
    expect(captured.cwd).toBe(repo);
    expect(captured.tools).not.toContain("write");
    expect((result.details as { tasks: Array<{ ok: boolean }> }).tasks[0]!.ok).toBe(true);
  });

  test("非 git 仓库 writable 明确失败，不建子会话", async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-subagent-plain-"));
    let called = false;
    try {
      const tool = createSubagentTool({
        cwd: plain,
        limits: { maxConcurrent: 1, timeoutMs: 5_000 },
        createSession: async () => {
          called = true;
          return fakeSession({}, false) as never;
        },
      });
      const result = await (tool as { execute: (id: string, params: unknown) => Promise<{ details: Record<string, unknown> }> })
        .execute("call-plain", { tasks: [{ prompt: "写文件" }], writable: true });
      expect(called).toBe(false);
      expect((result.details as { tasks: Array<{ ok: boolean; error?: string }> }).tasks[0]!.ok).toBe(false);
      expect((result.details as { tasks: Array<{ error?: string }> }).tasks[0]!.error).toContain("git 仓库");
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});
