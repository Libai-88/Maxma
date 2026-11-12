/**
 * kernel/shell-health.ts — 启动 shell 可用性探测（bash 起不来时自动降级到 powershell）。
 *
 * 事故（P2）：Windows 上 pi 的 bash 工具解析到 MSYS/Git Bash 后，子进程在某些
 * 目录/ACL 下会以 `NtCreateDirectoryObject … 0xC0000022` 直接死掉。工具只把这段
 * 原始 stderr 丢给模型，用户看到的是"执行了、又好像没执行"，而同一台机器上
 * powershell 完全正常——因为默认工具集里**没有** powershell，模型没有退路。
 *
 * 这里在创建会话时用 pi 官方的 `getShellConfig` / `getPowerShellConfig` 解析出
 * 实际命令并真跑一次 `echo ok`：失败就把 powershell 加进本会话工具集，并在
 * appendSystemPrompt 里明确告知模型。探测结果按进程缓存，不按会话重复付费。
 */

import { spawnSync } from "node:child_process";

import { getPowerShellConfig, getShellConfig } from "@earendil-works/pi-coding-agent";

export interface ShellProbe {
  ok: boolean;
  /** 实际解析到的可执行文件（诊断用）。 */
  shell: string;
  /** 失败原因（stderr 摘要），成功为空。 */
  detail: string;
}

interface CacheEntry extends ShellProbe {
  at: number;
}

const CACHE_MS = 60_000;
let bashCache: CacheEntry | null = null;
let psCache: CacheEntry | null = null;

function runProbe(resolve: () => { shell: string; args: string[] }): ShellProbe {
  let config: { shell: string; args: string[] };
  try {
    config = resolve();
  } catch (error) {
    return { ok: false, shell: "", detail: String(error instanceof Error ? error.message : error) };
  }
  try {
    // 用引擎解析出的参数形状（bash: -c / powershell: -NoProfile … -Command），
    // 再追加 `echo ok`；stdio 收干净，超时防挂死。
    const result = spawnSync(config.shell, [...config.args, "echo ok"], {
      timeout: 5_000,
      windowsHide: true,
      encoding: "utf8",
      env: process.env,
    });
    const stderr = String(result.stderr ?? "").trim();
    const stdout = String(result.stdout ?? "").trim();
    const ok = result.error === undefined && result.status === 0 && /ok/i.test(stdout);
    return {
      ok,
      shell: config.shell,
      detail: ok ? "" : (stderr || String(result.error ?? "")).slice(0, 400) || `exit ${String(result.status)}`,
    };
  } catch (error) {
    return { ok: false, shell: config.shell, detail: String(error instanceof Error ? error.message : error) };
  }
}

/** bash 是否真的能启动（结果缓存 60s）。 */
export function probeBash(force = false): ShellProbe {
  const now = Date.now();
  if (!force && bashCache && now - bashCache.at < CACHE_MS) return bashCache;
  bashCache = { ...runProbe(getShellConfig), at: now };
  return bashCache;
}

/** powershell 是否可用（仅 Windows 有意义）。 */
export function probePowerShell(force = false): ShellProbe {
  if (process.platform !== "win32") return { ok: false, shell: "", detail: "not windows" };
  const now = Date.now();
  if (!force && psCache && now - psCache.at < CACHE_MS) return psCache;
  psCache = { ...runProbe(getPowerShellConfig), at: now };
  return psCache;
}

/** 给模型的降级说明（只在 bash 探测失败时注入）。 */
export function powershellFallbackNote(bash: ShellProbe): string {
  return [
    "",
    "## 本机 shell 状态（Maxma 自动探测）",
    `bash 工具在当前机器上无法启动（${bash.detail.slice(0, 200)}）。`,
    "需要执行命令时请改用 `powershell` 工具（本会话已为你启用）；不要调用 bash 工具。",
    "如果 powershell 也不可用，请把错误原文告诉用户，不要假装执行成功。",
  ].join("\n");
}