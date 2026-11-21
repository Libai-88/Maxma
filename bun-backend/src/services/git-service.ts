/**
 * services/git-service.ts — 工作区 Git 只读状态与 diff（P2）。
 *
 * 只允许对用户显式授权的工作区根执行 git；参数不经 shell，path 走
 * workspace-fs 的路径段校验，再以 `--` 结尾传给 git，避免选项注入。
 * 输出有上限，仓库不是 git 时返回 isRepo=false，而不是报错。
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import type { WorkspaceRoot } from "./workspace-store";
import { splitRelativePath } from "./workspace-fs";

export type GitErrorCode = "GIT_UNAVAILABLE" | "GIT_NOT_REPO" | "PATH_INVALID" | "GIT_FAILED";

export class GitError extends Error {
  constructor(readonly code: GitErrorCode, readonly status: number, message: string) {
    super(message);
    this.name = "GitError";
  }
}

export interface GitFileStatus {
  path: string;
  oldPath?: string;
  index: string;
  worktree: string;
  staged: boolean;
  untracked: boolean;
  deleted: boolean;
  renamed: boolean;
}

export interface GitStatusResult {
  isRepo: boolean;
  branch: string | null;
  head: string | null;
  detached: boolean;
  files: GitFileStatus[];
  truncated: boolean;
  repoRoot: string | null;
}

export interface GitDiffResult {
  path: string;
  staged: boolean;
  patch: string;
  untracked: boolean;
  truncated: boolean;
}

const MAX_FILES = 500;
const MAX_PATCH_BYTES = 400 * 1024;

interface GitResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

const MAX_GIT_OUTPUT = 8 * 1024 * 1024;

/**
 * 异步跑 git：不能在工作区 HTTP 路由里用 spawnSync 阻塞 Bun 事件循环，
 * 否则一次大仓库 status 会让所有 WS/请求停摆。超时会杀掉子进程。
 */
function git(cwd: string, args: string[], timeout = 12_000): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let timedOut = false;
    let settled = false;
    const child = spawn("git", ["-c", "core.quotepath=false", ...args], {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* best effort */ }
    }, timeout);
    child.on("error", (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      finish(() => {
        if (code === "ENOENT") reject(new GitError("GIT_UNAVAILABLE", 503, "未找到 git 可执行文件"));
        else reject(new GitError("GIT_FAILED", 500, `git 执行失败：${error.message}`));
      });
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_GIT_OUTPUT) {
        try { child.kill(); } catch { /* best effort */ }
        finish(() => reject(new GitError("GIT_FAILED", 500, "git 输出超过 8 MiB")));
      } else {
        stdout += chunk.toString("utf8");
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("close", (status) => {
      finish(() => {
        if (timedOut) reject(new GitError("GIT_FAILED", 500, `git 超过 ${timeout}ms 未完成，已终止`));
        else resolve({ status, stdout, stderr });
      });
    });
  });
}

function parsePorcelain(stdout: string): { files: GitFileStatus[]; truncated: boolean } {
  const records = stdout.split("\0");
  const files: GitFileStatus[] = [];
  let truncated = false;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (files.length >= MAX_FILES) {
      truncated = true;
      break;
    }
    const indexStatus = record[0] ?? " ";
    const worktreeStatus = record[1] ?? " ";
    const filePath = record.slice(3);
    let oldPath: string | undefined;
    if ((indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C") && records[index + 1]) {
      oldPath = records[index + 1];
      index += 1;
    }
    const untracked = indexStatus === "?" && worktreeStatus === "?";
    files.push({
      path: filePath,
      oldPath,
      index: indexStatus,
      worktree: worktreeStatus,
      staged: !untracked && indexStatus !== " ",
      untracked,
      deleted: indexStatus === "D" || worktreeStatus === "D",
      renamed: indexStatus === "R" || worktreeStatus === "R",
    });
  }
  return { files, truncated };
}

export async function gitStatus(root: WorkspaceRoot): Promise<GitStatusResult> {
  if (!fs.existsSync(root.realpath)) {
    throw new GitError("PATH_INVALID", 404, "工作区根不存在");
  }
  const top = await git(root.realpath, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) {
    return { isRepo: false, branch: null, head: null, detached: false, files: [], truncated: false, repoRoot: null };
  }
  const repoRoot = top.stdout.trim();
  const branch = await git(root.realpath, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const detached = branch.status !== 0;
  const branchName = detached ? null : branch.stdout.trim() || null;
  const head = await git(root.realpath, ["rev-parse", "--short", "HEAD"]);
  const headId = head.status === 0 ? head.stdout.trim() : null;
  const status = await git(root.realpath, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]);
  if (status.status !== 0) {
    throw new GitError("GIT_FAILED", 500, status.stderr.trim() || "读取 git 状态失败");
  }
  const parsed = parsePorcelain(status.stdout);
  return {
    isRepo: true,
    branch: branchName,
    head: headId,
    detached,
    files: parsed.files,
    truncated: parsed.truncated,
    repoRoot,
  };
}

function safeGitPath(relative: string): string {
  const segments = splitRelativePath(relative, false);
  return segments.join("/");
}

/** `--` 之后的路径仍可能被当成 pathspec magic；用 literal 前缀彻底关掉。 */
function literalPath(relative: string): string {
  return `:(literal)${safeGitPath(relative)}`;
}

export async function gitDiff(root: WorkspaceRoot, relative: string, staged: boolean): Promise<GitDiffResult> {
  const cleanPath = safeGitPath(relative);
  const top = await git(root.realpath, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) throw new GitError("GIT_NOT_REPO", 400, "当前工作区不是 Git 仓库");

  const untrackedResult = await git(root.realpath, ["ls-files", "--others", "--exclude-standard", "-z", "--", literalPath(cleanPath)]);
  const untracked = untrackedResult.status === 0 && untrackedResult.stdout.split("\0").includes(cleanPath);
  if (untracked) {
    return { path: cleanPath, staged: false, patch: "", untracked: true, truncated: false };
  }

  const args = ["diff", "--no-color", "--unified=3", ...(staged ? ["--cached"] : []), "--", literalPath(cleanPath)];
  const diff = await git(root.realpath, args);
  if (diff.status !== 0) {
    throw new GitError("GIT_FAILED", 500, diff.stderr.trim() || "读取 diff 失败");
  }
  const patch = diff.stdout;
  if (Buffer.byteLength(patch, "utf8") <= MAX_PATCH_BYTES) {
    return { path: cleanPath, staged, patch, untracked: false, truncated: false };
  }
  return {
    path: cleanPath,
    staged,
    patch: patch.slice(0, MAX_PATCH_BYTES),
    untracked: false,
    truncated: true,
  };
}

/** 确保仓库根仍在用户授权的工作区根内（防止 git -C 被目录联接带出边界）。 */
export function assertRepoWithinRoot(root: WorkspaceRoot, repoRoot: string): void {
  const inside = path.relative(root.realpath, repoRoot);
  if (inside.startsWith("..") || path.isAbsolute(inside)) {
    throw new GitError("PATH_INVALID", 403, "Git 仓库不在工作区内");
  }
}

export interface GitCommitResult {
  commit: string | null;
  branch: string | null;
  summary: string;
}

async function assertRepo(root: WorkspaceRoot): Promise<void> {
  const top = await git(root.realpath, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) throw new GitError("GIT_NOT_REPO", 400, "当前工作区不是 Git 仓库");
}

export async function gitStage(root: WorkspaceRoot, paths: string[]): Promise<GitStatusResult> {
  await assertRepo(root);
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 200) {
    throw new GitError("PATH_INVALID", 400, "paths 必须是 1–200 个文件");
  }
  const literals = paths.map(literalPath);
  const result = await git(root.realpath, ["add", "--", ...literals]);
  if (result.status !== 0) throw new GitError("GIT_FAILED", 500, result.stderr.trim() || "暂存失败");
  return gitStatus(root);
}

export async function gitUnstage(root: WorkspaceRoot, paths: string[]): Promise<GitStatusResult> {
  await assertRepo(root);
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 200) {
    throw new GitError("PATH_INVALID", 400, "paths 必须是 1–200 个文件");
  }
  const literals = paths.map(literalPath);
  const hasHead = (await git(root.realpath, ["rev-parse", "--verify", "HEAD"])).status === 0;
  const result = hasHead
    ? await git(root.realpath, ["reset", "-q", "HEAD", "--", ...literals])
    : await git(root.realpath, ["rm", "--cached", "--ignore-unmatch", "-q", "--", ...literals]);
  if (result.status !== 0) throw new GitError("GIT_FAILED", 500, result.stderr.trim() || "取消暂存失败");
  return gitStatus(root);
}

export async function gitCommit(root: WorkspaceRoot, message: string, confirm: boolean): Promise<GitCommitResult> {
  await assertRepo(root);
  if (confirm !== true) throw new GitError("GIT_FAILED", 400, "提交必须显式确认");
  const trimmed = typeof message === "string" ? message.trim() : "";
  if (!trimmed) throw new GitError("PATH_INVALID", 400, "提交信息不能为空");
  if (trimmed.length > 5000) throw new GitError("PATH_INVALID", 400, "提交信息过长（上限 5000 字）");
  const staged = await git(root.realpath, ["diff", "--cached", "--name-only", "-z"]);
  if (staged.status !== 0) throw new GitError("GIT_FAILED", 500, "读取暂存区失败");
  if (!staged.stdout.split("\0").filter(Boolean).length) {
    throw new GitError("GIT_FAILED", 400, "暂存区为空，没有可提交的变更");
  }
  const result = await git(root.realpath, ["commit", "-m", trimmed], 20_000);
  if (result.status !== 0) throw new GitError("GIT_FAILED", 500, result.stderr.trim() || result.stdout.trim() || "提交失败");
  const head = await git(root.realpath, ["rev-parse", "--short", "HEAD"]);
  const branch = await git(root.realpath, ["symbolic-ref", "--short", "-q", "HEAD"]);
  return {
    commit: head.status === 0 ? head.stdout.trim() : null,
    branch: branch.status === 0 ? branch.stdout.trim() : null,
    summary: result.stdout.trim().split("\n")[0] ?? "已提交",
  };
}

export interface GitRemoteStatus {
  branch: string | null;
  detached: boolean;
  remote: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export async function gitRemoteStatus(root: WorkspaceRoot): Promise<GitRemoteStatus> {
  const remote = await git(root.realpath, ["remote", "get-url", "origin"]);
  const branch = await git(root.realpath, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const detached = branch.status !== 0;
  const upstream = await git(root.realpath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  let ahead = 0;
  let behind = 0;
  if (upstream.status === 0) {
    const counts = await git(root.realpath, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]);
    if (counts.status === 0) {
      const [left, right] = counts.stdout.trim().split(/\s+/).map((value) => Number.parseInt(value, 10));
      ahead = Number.isFinite(left) ? left ?? 0 : 0;
      behind = Number.isFinite(right) ? right ?? 0 : 0;
    }
  }
  return {
    branch: detached ? null : branch.stdout.trim() || null,
    detached,
    remote: remote.status === 0 ? remote.stdout.trim() : null,
    upstream: upstream.status === 0 ? upstream.stdout.trim() : null,
    ahead,
    behind,
  };
}

export interface GitPushResult {
  branch: string;
  remote: string;
  output: string;
}

/**
 * 推送只允许显式的 `confirm=true`，且固定 origin + 当前分支（不做任意 refspec）。
 * 不提供 force；网络动作由用户在工作台里按下按钮触发，不是 Agent 自作主张。
 */
export async function gitPush(root: WorkspaceRoot, confirm: boolean): Promise<GitPushResult> {
  await assertRepo(root);
  if (confirm !== true) throw new GitError("GIT_FAILED", 400, "推送必须显式确认");
  const branch = await git(root.realpath, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const branchName = branch.status === 0 ? branch.stdout.trim() : "";
  if (!branchName) throw new GitError("GIT_FAILED", 400, "detached HEAD 不能推送；请先切到分支");
  const remote = await git(root.realpath, ["remote", "get-url", "origin"]);
  if (remote.status !== 0 || !remote.stdout.trim()) throw new GitError("GIT_FAILED", 400, "没有 origin 远端，无法推送");
  const result = await git(root.realpath, ["push", "--porcelain", "origin", `HEAD:refs/heads/${branchName}`], 60_000);
  if (result.status !== 0) throw new GitError("GIT_FAILED", 500, result.stderr.trim() || result.stdout.trim() || "推送失败");
  return { branch: branchName, remote: remote.stdout.trim(), output: result.stdout.trim().slice(0, 4000) };
}

export interface GitPrResult {
  url: string | null;
  output: string;
}

/** 用 GitHub CLI 创建 PR；机器上没有 gh 或仓库不是 GitHub 时返回可读失败，不假装成功。 */
export async function gitCreatePullRequest(
  root: WorkspaceRoot,
  input: { title: string; body: string; base: string; confirm: boolean },
): Promise<GitPrResult> {
  await assertRepo(root);
  if (input.confirm !== true) throw new GitError("GIT_FAILED", 400, "创建 PR 必须显式确认");
  const title = input.title.trim();
  const base = input.base.trim();
  if (!title) throw new GitError("PATH_INVALID", 400, "PR 标题不能为空");
  if (title.length > 200) throw new GitError("PATH_INVALID", 400, "PR 标题过长（上限 200 字）");
  if (!base) throw new GitError("PATH_INVALID", 400, "base 分支不能为空");
  if (input.body.length > 10_000) throw new GitError("PATH_INVALID", 400, "PR 正文过长（上限 10000 字）");
  const branch = await git(root.realpath, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const branchName = branch.status === 0 ? branch.stdout.trim() : "";
  if (!branchName) throw new GitError("GIT_FAILED", 400, "detached HEAD 不能创建 PR");
  const gh = Bun.which("gh");
  if (!gh) throw new GitError("GIT_UNAVAILABLE", 503, "未找到 GitHub CLI（gh）；可手动推送后在网页创建 PR");
  const child = Bun.spawn([gh, "pr", "create", "--base", base, "--head", branchName, "--title", title, "--body", input.body], {
    cwd: root.realpath,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GH_PROMPT_DISABLED: "1" },
  });
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const code = await child.exited;
  if (code !== 0) throw new GitError("GIT_FAILED", 500, stderr.trim() || stdout.trim() || `gh 退出码 ${code}`);
  const url = /https?:\/\/\S+/.exec(stdout)?.[0] ?? null;
  return { url, output: stdout.trim().slice(0, 4000) };
}

