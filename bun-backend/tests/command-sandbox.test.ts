/**
 * tests/command-sandbox.test.ts — M1/T3 命令策略的纯函数负例矩阵。
 *
 * 只验策略层，不真跑危险命令；命令执行本身的超时/杀树由 workspace-p0 覆盖。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { evaluateCommand, sanitizedEnv } from "../src/services/command-sandbox";
import type { WorkspaceRoot } from "../src/services/workspace-store";

let dir = "";
let root: WorkspaceRoot;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "maxma-command-sandbox-"));
  root = {
    id: "root1",
    label: "test",
    path: dir,
    realpath: fs.realpathSync.native(dir),
    created_at: 1,
    last_used_at: 1,
  };
  for (const key of ["MAXMA_TEST_SECRET", "OPENAI_API_KEY", "AWS_SECRET_ACCESS_KEY"]) {
    savedEnv[key] = process.env[key];
    process.env[key] = "should-not-leak";
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("evaluateCommand", () => {
  test("普通工作区命令放行", () => {
    expect(evaluateCommand(root, "bun test").allowed).toBe(true);
    expect(evaluateCommand(root, "git status --short").allowed).toBe(true);
    expect(evaluateCommand(root, "node -e \"console.log('ok')\"").allowed).toBe(true);
  });

  test("路径逃逸、网络、危险系统命令默认拒绝", () => {
    const denied = [
      ["cat C:\\Windows\\win.ini", "COMMAND_PATH_ESCAPE"],
      ["cd ..", "COMMAND_PATH_ESCAPE"],
      ["cat %USERPROFILE%\\secret.txt", "COMMAND_PATH_ESCAPE"],
      ["curl https://example.com", "COMMAND_NETWORK_DENIED"],
      ["Invoke-WebRequest https://example.com", "COMMAND_NETWORK_DENIED"],
      ["format C:", "COMMAND_DANGEROUS"],
      ["reg add HKLM\\Software\\X", "COMMAND_DANGEROUS"],
    ] as const;
    for (const [command, code] of denied) {
      const result = evaluateCommand(root, command);
      expect(result.allowed, command).toBe(false);
      expect(result.code, command).toBe(code);
    }
  });

  test("显式 allowNetwork 只放宽网络命令，不放宽路径逃逸", () => {
    expect(evaluateCommand(root, "curl https://example.com", { allowNetwork: true }).allowed).toBe(true);
    const escape = evaluateCommand(root, "curl https://example.com -o C:\\Windows\\x", { allowNetwork: true });
    expect(escape.allowed).toBe(false);
    expect(escape.code).toBe("COMMAND_PATH_ESCAPE");
  });
});

describe("sanitizedEnv", () => {
  test("敏感变量不传入；HOME/USERPROFILE/TMP 落在工作区", () => {
    const env = sanitizedEnv(root);
    expect(env.MAXMA_TEST_SECRET).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.HOME).toBe(root.realpath);
    expect(env.USERPROFILE).toBe(root.realpath);
    expect(env.TMP?.startsWith(root.realpath)).toBe(true);
    expect(env.MAXMA_COMMAND_SANDBOX).toBe("policy-only");
    expect(typeof (env.PATH ?? env.Path)).toBe("string");
  });
});
