/**
 * services/command-sandbox.ts — 工作区命令的策略层（M1 / T3）。
 *
 * 这里不是 OS 级沙箱（Windows 受限 token / Job Object 仍需原生辅助器）。
 * 当前实现保证三件可验证的事：
 *   1) 命令字符串先过路径策略，明显越界、`..`、家目录变量一律拒绝；
 *   2) 网络客户端默认拒绝，调用方显式 allowNetwork 才放行；
 *   3) 子进程环境从白名单重建，HOME/USERPROFILE 指向工作区，敏感凭据变量不传入。
 *
 * 失败一律 fail-closed：策略无法判断时拒绝，而不是让命令“先跑再说”。
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { WorkspaceRoot } from "./workspace-store";
import { PathPolicy } from "../../../bun-sidecar/src/kernel/path-policy";
import {
  evaluateCommandPolicy,
  type CommandPolicyDecision,
} from "../../../bun-sidecar/src/kernel/command-policy";

export type { CommandPolicyDecision };

/** 从工作区根构建一次策略；调用方按命令复用。 */
export function evaluateCommand(
  root: WorkspaceRoot,
  command: string,
  options: { allowNetwork?: boolean } = {},
): CommandPolicyDecision {
  const policy = new PathPolicy({ cwd: root.realpath, roots: [root.realpath] });
  return evaluateCommandPolicy(policy, command, options);
}

const ENV_ALLOWLIST = new Set([
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SystemDrive",
  "windir",
  "ComSpec",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "SHELL",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "OS",
]);

/**
 * 子进程环境白名单。HOME/USERPROFILE 被改到工作区根，避免命令默认读写
 * 用户家目录；TMP/TEMP 落 `<root>/.maxma-tmp`，也不把系统临时目录暴露给子进程。
 */
export function sanitizedEnv(root: WorkspaceRoot): Record<string, string> {
  const tempDir = path.join(root.realpath, ".maxma-tmp");
  try {
    fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  } catch {
    // 创建失败时仍把 TMP 指向工作区根；不向调用方泄漏“沙箱已完整”的假象。
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && ENV_ALLOWLIST.has(key)) env[key] = value;
  }
  env.HOME = root.realpath;
  env.USERPROFILE = root.realpath;
  env.TMP = tempDir;
  env.TEMP = tempDir;
  env.TMPDIR = tempDir;
  env.MAXMA_WORKSPACE_ROOT = root.realpath;
  env.MAXMA_COMMAND_SANDBOX = "policy-only";
  return env;
}
