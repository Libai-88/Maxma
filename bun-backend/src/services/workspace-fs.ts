/**
 * services/workspace-fs.ts — 文件面板的路径校验与只读文件访问（Workbench 2.0 P0）。
 *
 * 安全边界：
 *  - 只接受相对路径；拒绝绝对路径、盘符、UNC、`..`、NUL、Win32 ADS；
 *  - 每一级都检查 symlink/junction，P0 不跟随符号链接；
 *  - realpath 后必须仍落在工作区根内；
 *  - 读取走 open + fstat + read，避免用先前的 stat 直接信任路径；
 *  - 文本 2 MiB / 图片 PDF 50 MiB 上限。
 *
 * 这里不做 HTTP 状态映射；路由层统一把 WorkspaceError 变成可区分错误。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

import type { WorkspaceRoot } from "./workspace-store";
import { findBlockerPath } from "../routes/maxma-blocker";

export type WorkspaceErrorCode =
  | "PATH_INVALID"
  | "PATH_OUTSIDE_ROOT"
  | "PATH_BLOCKED"
  | "FILE_TOO_LARGE"
  | "BINARY_NOT_PREVIEWABLE"
  | "WORKSPACE_ROOT_NOT_FOUND";

export class WorkspaceError extends Error {
  constructor(
    readonly code: WorkspaceErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_BLOB_BYTES = 50 * 1024 * 1024;
export const MAX_TREE_ENTRIES = 2000;

const IGNORED_NAMES = new Set([".git", ".hg", ".svn", "node_modules", "dist", "build", ".next", ".cache"]);

export type TreeEntryType = "file" | "dir" | "symlink" | "other";

export interface TreeEntry {
  name: string;
  path: string;
  type: TreeEntryType;
  size: number;
  mtime: number;
}

export interface TreeResult {
  path: string;
  entries: TreeEntry[];
  truncated: boolean;
}

export interface TextFileResult {
  path: string;
  content: string;
  mtime: number;
  size: number;
  hash: string;
}

export interface BlobFileResult {
  path: string;
  content: Buffer;
  mtime: number;
  size: number;
  contentType: string;
}

function fail(code: WorkspaceErrorCode, status: number, message: string): never {
  throw new WorkspaceError(code, status, message);
}

/** 将前端传来的相对路径拆成安全的路径段。 */
export function splitRelativePath(input: string, allowEmpty: boolean): string[] {
  if (typeof input !== "string" || input.includes("\x00")) fail("PATH_INVALID", 400, "路径包含非法字符");
  if (/\x00|\x01|\x02|\x03|\x04|\x05|\x06|\x07|\x08|\x0b|\x0c|\x0e|\x0f/.test(input)) {
    fail("PATH_INVALID", 400, "路径包含控制字符");
  }
  // 绝对路径、盘符、UNC、POSIX 根路径都拒绝。
  if (/^[A-Za-z]:/.test(input) || input.startsWith("/") || input.startsWith("\\")) {
    fail("PATH_OUTSIDE_ROOT", 403, "只接受工作区内的相对路径");
  }
  const raw = input.replace(/\\/g, "/");
  if (raw === "" || raw === ".") {
    if (allowEmpty) return [];
    fail("PATH_INVALID", 400, "路径不能为空");
  }
  const segments = raw.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    if (allowEmpty) return [];
    fail("PATH_INVALID", 400, "路径不能为空");
  }
  for (const segment of segments) {
    if (segment === "..") fail("PATH_OUTSIDE_ROOT", 403, "路径不能跳出工作区");
    if (segment === ".") continue;
    // Win32 ADS / 盘符残留：文件面板不接受任何冒号路径。
    if (segment.includes(":")) fail("PATH_INVALID", 400, "路径包含非法冒号");
  }
  return segments.filter((segment) => segment !== ".");
}

function assertInsideRoot(root: WorkspaceRoot, candidate: string): void {
  const rootReal = fs.realpathSync.native(root.realpath);
  const candidateReal = fs.realpathSync.native(candidate);
  const rel = path.relative(rootReal, candidateReal);
  if (rel === "") return;
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    fail("PATH_OUTSIDE_ROOT", 403, "路径不在工作区内");
  }
}

/**
 * 解析并校验路径。P0 明确拒绝符号链接/junction：
 * 目录树可以展示它们，但不能通过它们读取内容。
 */
export function resolveWorkspacePath(root: WorkspaceRoot, relative: string, allowEmpty = false): string {
  const segments = splitRelativePath(relative, allowEmpty);
  let current = root.realpath;

  try {
    // 根目录本身必须存在；realpath 统一此处的大小写/链接形态。
    fs.accessSync(current, fs.constants.R_OK);
  } catch {
    fail("WORKSPACE_ROOT_NOT_FOUND", 404, "工作区根不存在或不可访问");
  }

  for (const segment of segments) {
    current = path.join(current, segment);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch {
      fail("PATH_INVALID", 404, "文件或目录不存在");
    }
    if (stat.isSymbolicLink()) {
      fail("PATH_OUTSIDE_ROOT", 403, "P0 不跟随符号链接或目录联接");
    }
  }

  try {
    assertInsideRoot(root, current);
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    fail("PATH_INVALID", 404, "路径不可访问");
  }
  return current;
}

function relativeDisplay(root: WorkspaceRoot, fullPath: string): string {
  const rel = path.relative(root.realpath, fullPath);
  return rel.split(path.sep).join("/");
}

function blockerOf(fullPath: string): void {
  const blocker = findBlockerPath(fullPath);
  if (blocker) {
    fail("PATH_BLOCKED", 403, `路径包含 MaxmaBlocker 拒止锚：${blocker}`);
  }
}

function assertRegularFile(fullPath: string): fs.Stats {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    fail("PATH_INVALID", 404, "文件不存在");
  }
  if (!stat.isFile()) fail("PATH_INVALID", 400, "目标不是普通文件");
  return stat;
}

function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function isProbablyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  let suspicious = 0;
  for (const byte of buffer) {
    if (byte === 0) return true;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) suspicious += 1;
  }
  return suspicious / buffer.length > 0.1;
}

function readWholeFd(fd: number, size: number): Buffer {
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const read = fs.readSync(fd, buffer, offset, size - offset, offset);
    if (read <= 0) break;
    offset += read;
  }
  return buffer.subarray(0, offset);
}

export function listTree(root: WorkspaceRoot, relative: string, showIgnored: boolean): TreeResult {
  const fullPath = resolveWorkspacePath(root, relative, true);
  blockerOf(fullPath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    fail("PATH_INVALID", 404, "目录不存在");
  }
  if (!stat.isDirectory()) fail("PATH_INVALID", 400, "目标不是目录");

  const entries: TreeEntry[] = [];
  let truncated = false;
  const list = fs.readdirSync(fullPath, { withFileTypes: true });
  for (const item of list) {
    if (!showIgnored && IGNORED_NAMES.has(item.name.toLowerCase())) continue;
    if (entries.length >= MAX_TREE_ENTRIES) {
      truncated = true;
      break;
    }
    const child = path.join(fullPath, item.name);
    let childStat: fs.Stats;
    try {
      childStat = fs.lstatSync(child);
    } catch {
      continue;
    }
    const type: TreeEntryType = item.isDirectory()
      ? "dir"
      : item.isFile()
        ? "file"
        : item.isSymbolicLink()
          ? "symlink"
          : "other";
    entries.push({
      name: item.name,
      path: relativeDisplay(root, child),
      type,
      size: childStat.size,
      mtime: childStat.mtimeMs,
    });
  }
  entries.sort((a, b) => {
    const aRank = a.type === "dir" ? 0 : a.type === "file" ? 1 : 2;
    const bRank = b.type === "dir" ? 0 : b.type === "file" ? 1 : 2;
    return aRank - bRank || a.name.localeCompare(b.name, "zh-CN");
  });
  return { path: relativeDisplay(root, fullPath), entries, truncated };
}

export function readTextFile(root: WorkspaceRoot, relative: string): TextFileResult {
  const fullPath = resolveWorkspacePath(root, relative);
  blockerOf(fullPath);
  assertRegularFile(fullPath);

  let fd: number;
  try {
    fd = fs.openSync(fullPath, "r");
  } catch {
    fail("PATH_INVALID", 404, "文件不可读");
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) fail("PATH_INVALID", 400, "目标不是普通文件");
    if (stat.size > MAX_TEXT_BYTES) fail("FILE_TOO_LARGE", 413, `文本文件超过 ${MAX_TEXT_BYTES} 字节`);
    const head = Buffer.alloc(Math.min(8192, stat.size));
    if (head.length > 0) fs.readSync(fd, head, 0, head.length, 0);
    if (isProbablyBinary(head)) fail("BINARY_NOT_PREVIEWABLE", 415, "二进制文件不能按文本预览");
    const contentBuffer = readWholeFd(fd, stat.size);
    return {
      path: relativeDisplay(root, fullPath),
      content: contentBuffer.toString("utf8"),
      mtime: stat.mtimeMs,
      size: stat.size,
      hash: hashBuffer(contentBuffer),
    };
  } finally {
    try { fs.closeSync(fd); } catch { /* best effort */ }
  }
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
};

export function readBlobFile(root: WorkspaceRoot, relative: string): BlobFileResult {
  const fullPath = resolveWorkspacePath(root, relative);
  blockerOf(fullPath);
  const fileStat = assertRegularFile(fullPath);
  if (fileStat.size > MAX_BLOB_BYTES) fail("FILE_TOO_LARGE", 413, `二进制文件超过 ${MAX_BLOB_BYTES} 字节`);
  const ext = path.extname(fullPath).slice(1).toLowerCase();
  const contentType = IMAGE_TYPES[ext];
  if (!contentType) fail("BINARY_NOT_PREVIEWABLE", 415, "该类型不支持文件面板预览");

  let fd: number;
  try {
    fd = fs.openSync(fullPath, "r");
  } catch {
    fail("PATH_INVALID", 404, "文件不可读");
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) fail("PATH_INVALID", 400, "目标不是普通文件");
    if (stat.size > MAX_BLOB_BYTES) fail("FILE_TOO_LARGE", 413, `二进制文件超过 ${MAX_BLOB_BYTES} 字节`);
    const content = readWholeFd(fd, stat.size);
    return {
      path: relativeDisplay(root, fullPath),
      content,
      mtime: stat.mtimeMs,
      size: stat.size,
      contentType,
    };
  } finally {
    try { fs.closeSync(fd); } catch { /* best effort */ }
  }
}
