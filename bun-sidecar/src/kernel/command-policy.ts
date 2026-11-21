/**
 * kernel/command-policy.ts — 命令策略的单一判据（M1 / T3）。
 *
 * 同时被 Agent 的 bash/powershell preflight 与 Workbench 命令运行器使用，
 * 避免两边各抄一份 network/dangerous 正则后漂移。
 * 它只做策略判定；OS 级隔离仍由调用方实现（Windows 当前为降级）。
 */

import type { PathPolicy } from "./path-policy";

export type CommandPolicyCode =
  | "COMMAND_INVALID"
  | "COMMAND_PATH_ESCAPE"
  | "COMMAND_NETWORK_DENIED"
  | "COMMAND_DANGEROUS";

export interface CommandPolicyDecision {
  allowed: boolean;
  code?: CommandPolicyCode;
  reason?: string;
}

const NETWORK_COMMANDS = /\b(?:curl|wget|invoke-webrequest|invoke-restmethod|ssh|scp|sftp|ftp|telnet|nc|ncat|socat)\b/i;
const DANGEROUS_COMMANDS = /\b(?:format|diskpart|shutdown|restart-computer|stop-computer|reg\s+(?:add|delete)|sc\s+(?:create|delete)|bcdedit|takeown|icacls)\b/i;
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;

export interface CommandPolicyOptions {
  allowNetwork?: boolean;
  /** 仅用于错误信息；策略本身跨平台。 */
  toolName?: string;
}

export function evaluateCommandPolicy(
  policy: PathPolicy,
  command: string,
  options: CommandPolicyOptions = {},
): CommandPolicyDecision {
  if (typeof command !== "string" || !command.trim()) {
    return { allowed: false, code: "COMMAND_INVALID", reason: "命令不能为空" };
  }
  if (CONTROL.test(command)) {
    return { allowed: false, code: "COMMAND_INVALID", reason: "命令包含控制字符" };
  }
  if (!options.allowNetwork && NETWORK_COMMANDS.test(command)) {
    return {
      allowed: false,
      code: "COMMAND_NETWORK_DENIED",
      reason: "网络命令默认拒绝；需要联网的操作应走专用 Web 工具或显式授权",
    };
  }
  if (DANGEROUS_COMMANDS.test(command)) {
    return { allowed: false, code: "COMMAND_DANGEROUS", reason: "命令属于系统破坏性操作，已拒绝执行" };
  }
  const pathDecision = policy.checkCommand(command);
  if (!pathDecision.allowed) {
    return {
      allowed: false,
      code: "COMMAND_PATH_ESCAPE",
      reason: pathDecision.reason ?? "命令包含越界路径",
    };
  }
  return { allowed: true };
}

/**
 * 为 Agent shell 命令生成环境重建前缀。命令本身不改写，只在其前面设置
 * HOME/TMP 并清掉常见凭据变量；这不能阻止进程读取任意文件（那需要 OS
 * 沙箱），但能避免“默认拿用户家目录和 API key 跑命令”的静默扩权。
 */
export function shellEnvPrefix(shell: "bash" | "powershell", root: string): string {
  const normalizedRoot = root.replace(/\\/g, "/");
  const tmp = `${normalizedRoot}/.maxma-tmp`;
  const quoteBash = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  if (shell === "powershell") {
    const quotePs = (value: string) => `'${value.replace(/'/g, "''")}'`;
    return [
      `$env:HOME=${quotePs(root)}`,
      `$env:USERPROFILE=${quotePs(root)}`,
      `$env:TMP=${quotePs(`${root}\\.maxma-tmp`)}`,
      `$env:TEMP=$env:TMP`,
      `$env:MAXMA_COMMAND_SANDBOX='policy-only'`,
      "Remove-Item Env:OPENAI_API_KEY,Env:ANTHROPIC_API_KEY,Env:AWS_ACCESS_KEY_ID,Env:AWS_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue",
    ].join("; ") + "; ";
  }
  return [
    `export HOME=${quoteBash(normalizedRoot)}`,
    `export TMPDIR=${quoteBash(tmp)}`,
    `export TMP=${quoteBash(tmp)}`,
    `export TEMP=${quoteBash(tmp)}`,
    "export MAXMA_COMMAND_SANDBOX='policy-only'",
    "unset OPENAI_API_KEY ANTHROPIC_API_KEY AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY GITHUB_TOKEN GH_TOKEN",
  ].join("; ") + "; ";
}
