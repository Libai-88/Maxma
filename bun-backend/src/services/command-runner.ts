/**
 * services/command-runner.ts — 工作区命令运行器（P2，无 TTY）。
 *
 * 不是终端：不分配 PTY、不保持交互会话。每次运行都是一次性进程，
 * cwd 固定为已授权工作区根，超时或输出超限会杀进程树。该接口只允许
 * loopback；UI 默认关闭，用户显式启用后才发请求。
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import type { WorkspaceRoot } from "./workspace-store";

export interface CommandResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  truncated: boolean;
  durationMs: number;
}

const MAX_COMMAND_LENGTH = 2000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 120_000;

function appendCapped(current: string, chunk: string): { text: string; truncated: boolean } {
  const next = current + chunk;
  if (Buffer.byteLength(next, "utf8") <= MAX_OUTPUT_BYTES) return { text: next, truncated: false };
  return { text: next.slice(0, MAX_OUTPUT_BYTES), truncated: true };
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    try { process.kill(pid, "SIGKILL"); } catch { /* best effort */ }
  }
}

export function runWorkspaceCommand(
  root: WorkspaceRoot,
  command: string,
  timeoutMs?: number,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    if (typeof command !== "string" || !command.trim()) {
      reject(new Error("命令不能为空"));
      return;
    }
    if (command.length > MAX_COMMAND_LENGTH) {
      reject(new Error(`命令过长（上限 ${MAX_COMMAND_LENGTH} 字符）`));
      return;
    }
    if (!fs.existsSync(root.realpath)) {
      reject(new Error("工作区根不存在或不可访问"));
      return;
    }
    const timeout = Math.min(MAX_TIMEOUT_MS, Math.max(1000, timeoutMs ?? DEFAULT_TIMEOUT_MS));
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;

    const child = spawn(command, {
      cwd: root.realpath,
      shell: true,
      windowsHide: true,
      detached: process.platform !== "win32",
      env: { ...process.env, MAXMA_WORKSPACE_ROOT: root.realpath },
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeout);

    child.stdout?.on("data", (data: Buffer) => {
      const result = appendCapped(stdout, data.toString("utf8"));
      stdout = result.text;
      if (result.truncated) {
        truncated = true;
        killTree(child.pid);
      }
    });
    child.stderr?.on("data", (data: Buffer) => {
      const result = appendCapped(stderr, data.toString("utf8"));
      stderr = result.text;
      if (result.truncated) {
        truncated = true;
        killTree(child.pid);
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        command,
        stdout,
        stderr,
        exitCode: code,
        signal,
        timedOut,
        truncated,
        durationMs: Date.now() - started,
      });
    });
  });
}
