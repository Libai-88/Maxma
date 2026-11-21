/**
 * kernel/path-policy.ts — 本地文件访问的路径策略（M1 / T2）。
 *
 * 目标不是替代各工具自己的参数校验，而是在 `tool_call` 执行前做统一 preflight：
 *   - 只允许落在显式授权根（会话 cwd / 工作区根 / 用户 allowlist）内的路径；
 *   - 拒绝绝对越界、盘符相对路径、UNC、Win32 ADS、`..`、`~`、环境变量展开；
 *   - 已有路径逐段 lstat，符号链接 / junction 一律不跟随；
 *   - 写入目标可以尚不存在，但其最近存在祖先必须在根内且不是链接。
 *
 * 这里刻意不做“路径字符串看起来没问题就放行”的乐观判断：任何解析失败、
 * realpath 失败、权限不足都返回 deny。命令字符串的检查只是保守补充，真正的
 * OS 级命令隔离在 sandbox 层（当前 Windows 为降级实现，见 security-contract）。
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type PathIntent = "read" | "write" | "execute";

export type PathPolicyCode =
  | "PATH_INVALID"
  | "PATH_OUTSIDE_ROOT"
  | "PATH_SYMLINK"
  | "PATH_NOT_FOUND"
  | "PATH_COMMAND_ESCAPE";

export interface PathPolicyDecision {
  allowed: boolean;
  /** 解析后的绝对路径；deny 时也尽量给出候选路径，便于审计。 */
  resolved?: string;
  root?: string;
  code?: PathPolicyCode;
  reason?: string;
}

interface PolicyRoot {
  /** 用户给出的词法根（用于判断候选词法位置）。 */
  lexical: string;
  /** realpath 后的根（用于判断真实位置）。 */
  real: string;
}

export interface PathPolicyOptions {
  roots: string[];
  allowlist?: string[];
  cwd?: string;
}

const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;
const ENV_EXPANSION = /(?:^|[\\/])(?:\$HOME|\$USERPROFILE|%USERPROFILE%|%HOMEDRIVE%|%HOMEPATH%)/i;

/** RPC 参数里的字符串列表：非数组、空串、非字符串一律丢弃（不把“大概像”当授权）。 */
export function nonEmptyStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function deny(code: PathPolicyCode, reason: string, resolved?: string, root?: string): PathPolicyDecision {
  return { allowed: false, code, reason, ...(resolved ? { resolved } : {}), ...(root ? { root } : {}) };
}

function allow(resolved: string, root: string): PathPolicyDecision {
  return { allowed: true, resolved, root };
}

function comparePath(p: string): string {
  return process.platform === "win32" ? p.toLowerCase() : p;
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(comparePath(root), comparePath(candidate));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function normalizeRoot(input: string): PolicyRoot | null {
  try {
    if (typeof input !== "string" || !input.trim() || CONTROL_CHARS.test(input)) return null;
    const lexical = path.resolve(input.trim());
    const stat = fs.statSync(lexical);
    if (!stat.isDirectory()) return null;
    return { lexical, real: fs.realpathSync.native(lexical) };
  } catch {
    return null;
  }
}

/**
 * 路径语法校验。返回 null 表示语法可继续解析，返回字符串表示拒绝原因。
 * 注意：这里拒绝 `..`，即使它最终仍落在根内——策略选择简单的“不解释穿越”，
 * 避免出现 `a/../../root` 这类靠规范化才安全的路径。
 */
export function validatePathSyntax(raw: string): string | null {
  if (typeof raw !== "string" || !raw.trim()) return "路径不能为空";
  if (CONTROL_CHARS.test(raw) || raw.includes("\x00")) return "路径包含控制字符";
  if (ENV_EXPANSION.test(raw)) return "路径包含环境变量或家目录展开";
  if (raw.startsWith("\\\\?\\") || raw.startsWith("\\\\.\\")) return "不允许 Win32 设备命名空间路径";
  if (raw.startsWith("//") || raw.startsWith("\\\\")) return "不允许 UNC 网络路径";
  if (raw.startsWith("~")) return "不允许家目录展开路径";
  // C:foo 是盘符相对路径（相对于该盘当前目录），不是 C:\foo；一律拒绝。
  if (/^[A-Za-z]:[^\\/]/.test(raw)) return "不允许盘符相对路径";
  // 在非 Windows 上把 C:\... / C:/... 当普通相对路径会让它意外落进 cwd；
  // 跨平台策略统一按“外部绝对路径”拒绝，避免测试/CI 与真机语义分叉。
  if (process.platform !== "win32" && /^[A-Za-z]:[\\/]/.test(raw)) return "不允许跨平台盘符绝对路径";

  const normalized = raw.replace(/\\/g, "/");
  const drive = normalized.match(/^[A-Za-z]:/)?.[0] ?? "";
  const rest = drive ? normalized.slice(drive.length) : normalized;
  for (const segment of rest.split("/")) {
    if (!segment) continue;
    if (segment === "..") return "路径不能包含 .. 穿越";
    // ADS / 文件名冒号；盘符已在上面剥离。
    if (segment.includes(":")) return "路径包含非法冒号（Win32 ADS）";
  }
  return null;
}

/** 逐段检查从根到候选路径是否出现 symlink/junction；缺失段跳过（写入新文件时合法）。 */
function hasSymlinkSegment(rootReal: string, candidate: string): boolean {
  if (!isInside(rootReal, candidate)) return true;
  const rel = path.relative(rootReal, candidate);
  if (!rel) return false;
  let current = rootReal;
  for (const segment of rel.split(path.sep)) {
    if (!segment) continue;
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) return true;
    } catch {
      // 目标或中间目录尚不存在：后续由父目录检查兜底。
      return false;
    }
  }
  return false;
}

function nearestExistingAncestor(candidate: string): string | null {
  let current = candidate;
  while (true) {
    try {
      fs.lstatSync(current);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

export class PathPolicy {
  private readonly roots: PolicyRoot[];
  private readonly cwd: string;

  constructor(options: PathPolicyOptions) {
    const roots = [...options.roots, ...(options.allowlist ?? [])]
      .map(normalizeRoot)
      .filter((root): root is PolicyRoot => root !== null);
    // 去重：同一个根同时以词法和 realpath 出现时只保留一份。
    const unique: PolicyRoot[] = [];
    for (const root of roots) {
      if (!unique.some((item) => comparePath(item.real) === comparePath(root.real))) unique.push(root);
    }
    this.roots = unique;
    try {
      this.cwd = fs.realpathSync.native(path.resolve(options.cwd ?? process.cwd()));
    } catch {
      this.cwd = path.resolve(options.cwd ?? process.cwd());
    }
  }

  get rootCount(): number {
    return this.roots.length;
  }

  /** 检查一个文件路径。intent=read 时目标必须存在；write 允许目标不存在。 */
  check(rawPath: string, intent: PathIntent = "read"): PathPolicyDecision {
    const syntaxError = validatePathSyntax(rawPath);
    if (syntaxError) return deny("PATH_INVALID", syntaxError, typeof rawPath === "string" ? rawPath : "");

    const candidate = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(this.cwd, rawPath);
    if (this.roots.length === 0) {
      return deny("PATH_OUTSIDE_ROOT", "会话没有可用的授权根，路径策略 fail-closed", candidate);
    }

    // 先按词法位置找根；候选可能通过 realpath 落进另一个根（例如根本身是链接），
    // 因此再按真实路径兜底匹配一次。
    const lexicalRoot = this.roots.find((root) => isInside(root.lexical, candidate));
    const candidateReal = safeRealpath(candidate);
    const realRoot = candidateReal
      ? this.roots.find((root) => isInside(root.real, candidateReal))
      : undefined;
    const root = realRoot ?? lexicalRoot;
    if (!root) {
      return deny("PATH_OUTSIDE_ROOT", `路径不在授权工作区内：${rawPath}`, candidate);
    }

    if (intent === "read") {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(candidate);
      } catch {
        return deny("PATH_NOT_FOUND", "读取目标不存在", candidate, root.real);
      }
      if (!stat.isFile() && !stat.isDirectory()) {
        return deny("PATH_INVALID", "读取目标不是普通文件或目录", candidate, root.real);
      }
      // 先按词法路径逐段 lstat：这样 symlink 逃逸会得到明确的 PATH_SYMLINK，
      // 而不是在 realpath 之后才被当成普通越界。根可能是用户授权的链接，
      // 根自身不做链接判定。
      const lexicalBase = isInside(root.lexical, candidate) ? root.lexical : root.real;
      if (hasSymlinkSegment(lexicalBase, candidate)) {
        return deny("PATH_SYMLINK", "路径包含符号链接或目录联接，P0 不跟随", candidate, root.real);
      }
      if (!candidateReal || !isInside(root.real, candidateReal)) {
        return deny("PATH_OUTSIDE_ROOT", "realpath 后不在授权根内", candidate, root.real);
      }
      return allow(candidateReal, root.real);
    }

    // write / execute：目标可以不存在，但最近存在的祖先必须是根内真实目录。
    const ancestor = nearestExistingAncestor(candidate);
    if (!ancestor) {
      return deny("PATH_NOT_FOUND", "找不到可用的父目录", candidate, root.real);
    }
    const lexicalBase = isInside(root.lexical, ancestor) ? root.lexical : root.real;
    if (hasSymlinkSegment(lexicalBase, ancestor)) {
      return deny("PATH_SYMLINK", "写入路径包含符号链接或目录联接，P0 不跟随", ancestor, root.real);
    }
    if (!isInside(root.real, ancestor) && !isInside(root.real, safeRealpath(ancestor) ?? "")) {
      return deny("PATH_OUTSIDE_ROOT", "写入目标的父目录不在授权根内", candidate, root.real);
    }
    const ancestorReal = safeRealpath(ancestor);
    if (!ancestorReal || !isInside(root.real, ancestorReal)) {
      return deny("PATH_OUTSIDE_ROOT", "父目录 realpath 后不在授权根内", ancestor, root.real);
    }
    if (hasSymlinkSegment(root.real, ancestorReal)) {
      return deny("PATH_SYMLINK", "写入路径包含符号链接或目录联接，P0 不跟随", ancestor, root.real);
    }
    const existingReal = safeRealpath(candidate);
    if (existingReal && !isInside(root.real, existingReal)) {
      return deny("PATH_OUTSIDE_ROOT", "目标 realpath 后不在授权根内", candidate, root.real);
    }
    return allow(candidate, root.real);
  }

  /**
   * 保守检查命令字符串中的明显逃逸。它不是 shell 解析器：只拦截可识别的
   * Windows 绝对路径、UNC、家目录/环境变量和 `..`；真正的隔离由命令守卫负责。
   * 识别不了不等于安全——这里返回 allowed 只是“没有明显逃逸”。
   */
  checkCommand(command: string): PathPolicyDecision {
    if (typeof command !== "string" || !command.trim()) {
      return deny("PATH_COMMAND_ESCAPE", "命令不能为空");
    }
    if (CONTROL_CHARS.test(command)) {
      return deny("PATH_COMMAND_ESCAPE", "命令包含控制字符");
    }
    if (/(?:^|[^A-Za-z0-9_:])(?:~|\$HOME|\$USERPROFILE|%USERPROFILE%|%HOMEDRIVE%|%HOMEPATH%)/i.test(command)) {
      return deny("PATH_COMMAND_ESCAPE", "命令引用了家目录或用户目录环境变量");
    }
    if (/\.\.(?:[\\/]|$)/.test(command)) {
      return deny("PATH_COMMAND_ESCAPE", "命令包含 .. 目录穿越");
    }

    const absoluteCandidates = new Set<string>();
    // Windows 盘符绝对路径；排除 http:// 之类协议里的冒号。
    for (const match of command.matchAll(/[A-Za-z]:[\\/][^\s"'`|;<>()]*/g)) {
      absoluteCandidates.add(match[0]);
    }
    // UNC。
    for (const match of command.matchAll(/\\\\[^\s"'`|;<>()]+/g)) {
      absoluteCandidates.add(match[0]);
    }
    // POSIX 绝对路径只在非 Windows 上作为命令路径判断；Windows 的 `/` 常出现在参数里。
    if (process.platform !== "win32") {
      for (const match of command.matchAll(/\s(\/[^\s"'`|;<>()]+)/g)) {
        if (match[1] && !match[1].startsWith("//")) absoluteCandidates.add(match[1]);
      }
    }

    for (const candidate of absoluteCandidates) {
      if (candidate.includes("://")) continue;
      const decision = this.check(candidate, "execute");
      if (!decision.allowed) {
        return deny(
          "PATH_COMMAND_ESCAPE",
          `命令包含越界路径（${candidate}）：${decision.reason ?? "路径策略拒绝"}`,
        );
      }
    }
    return { allowed: true };
  }
}

function safeRealpath(p: string): string | null {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}
