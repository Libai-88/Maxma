/**
 * tools/patch.ts — 多文件事务式编辑（C4）。
 *
 * 与 `write`/`edit` 的区别：
 *   - 一次调用修改多个文件；先全部预检（存在性、精确匹配次数、越界/符号链接），
 *     再写临时文件并 rename，任一步失败按备份回滚；
 *   - 可选 `verify=typecheck`：写完跑一次 `bun x tsc --noEmit`，失败自动回滚；
 *   - 不做 shell 解析，也不执行用户提供的任意命令（验证命令是固定枚举）。
 * 仍是进程内事务，不是崩溃一致性保证；真正的长期备份由审计快照负责。
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import type { MaxmaToolDescriptor, MaxmaToolResult } from "./descriptor";

const MAX_FILES = 20;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

interface PatchEdit {
  path: string;
  old_string?: string;
  new_string?: string;
  content?: string;
  replace_all?: boolean;
}

interface Backup {
  absolute: string;
  existed: boolean;
  bytes?: string;
}

function result(text: string, details?: unknown): MaxmaToolResult {
  return { content: [{ type: "text", text }], details };
}

function resolveInside(cwd: string, requested: string): string {
  const root = path.resolve(cwd);
  const absolute = path.resolve(root, requested);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`路径越界：${requested}`);
  let probe = absolute;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const realParent = fs.realpathSync.native(probe);
  const realTarget = fs.existsSync(absolute) ? fs.realpathSync.native(absolute) : path.join(realParent, path.relative(probe, absolute));
  const realRelative = path.relative(fs.realpathSync.native(root), realTarget);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) throw new Error(`路径经符号链接逃逸：${requested}`);
  return absolute;
}

function readBackup(absolute: string): Backup {
  if (!fs.existsSync(absolute)) return { absolute, existed: false };
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`目标不是普通文件：${absolute}`);
  if (stat.size > MAX_FILE_BYTES) throw new Error(`文件超过 8 MiB：${absolute}`);
  return { absolute, existed: true, bytes: fs.readFileSync(absolute, "utf8") };
}

function replaceExact(content: string, oldText: string, newText: string, all: boolean): string {
  if (!oldText) throw new Error("old_string 不能为空");
  const occurrences: number[] = [];
  let from = 0;
  while (true) {
    const at = content.indexOf(oldText, from);
    if (at < 0) break;
    occurrences.push(at);
    from = at + oldText.length;
    if (occurrences.length > 1 && !all) break;
  }
  if (occurrences.length === 0) throw new Error("old_string 未匹配到内容");
  if (!all && occurrences.length !== 1) throw new Error(`old_string 匹配到 ${occurrences.length} 处，拒绝歧义替换；请提供更多上下文或 replace_all=true`);
  if (all) return content.split(oldText).join(newText);
  const at = occurrences[0]!;
  return content.slice(0, at) + newText + content.slice(at + oldText.length);
}

function writeAtomic(absolute: string, content: string): void {
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temp = `${absolute}.maxma-tmp-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  try {
    fs.writeFileSync(temp, content, "utf8");
    fs.renameSync(temp, absolute);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch { /* best effort */ }
    throw error;
  }
}

function rollback(backups: Backup[]): void {
  for (const backup of backups) {
    try {
      if (backup.existed && backup.bytes !== undefined) writeAtomic(backup.absolute, backup.bytes);
      else if (!backup.existed) fs.rmSync(backup.absolute, { force: true });
    } catch (error) {
      console.warn("[patch] rollback failed:", backup.absolute, error);
    }
  }
}

async function typecheck(cwd: string): Promise<{ ok: boolean; output: string }> {
  const bun = Bun.which("bun");
  if (!bun) return { ok: false, output: "未找到 bun，无法执行 typecheck" };
  const child = Bun.spawn([bun, "x", "tsc", "--noEmit"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, HOME: cwd, USERPROFILE: cwd, TMPDIR: cwd },
  });
  const timer = setTimeout(() => {
    try { child.kill(); } catch { /* best effort */ }
  }, 60_000);
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const exitCode = await child.exited;
  clearTimeout(timer);
  const output = `${stdout}\n${stderr}`.trim();
  return { ok: exitCode === 0, output: output.slice(0, 4000) || `tsc 退出码 ${exitCode}` };
}

export function applyPatchTool(cwd: string): MaxmaToolDescriptor {
  return {
    name: "code_apply_patch",
    label: "Apply Patch",
    description: "在授权工作区内事务式修改多个文件：全部预检后写入，失败回滚；可选 typecheck 验证，失败自动回滚。不是崩溃一致性保证。",
    parameters: {
      type: "object",
      properties: {
        edits: {
          type: "array",
          minItems: 1,
          maxItems: MAX_FILES,
          description: "编辑列表；每项给 path 与 old_string/new_string，或 path 与 content 整体写入",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "相对于当前工作区的路径" },
              old_string: { type: "string" },
              new_string: { type: "string" },
              content: { type: "string", description: "整体写入内容；与 old_string 二选一" },
              replace_all: { type: "boolean", description: "是否替换全部匹配，默认 false" },
            },
            required: ["path"],
            additionalProperties: false,
          },
        },
        allow_create: { type: "boolean", description: "允许创建新文件，默认 false" },
        allow_overwrite: { type: "boolean", description: "允许整体写入覆盖已有文件，默认 false" },
        verify: { type: "string", enum: ["none", "typecheck"], description: "写入后的固定验证；默认 none" },
      },
      required: ["edits"],
      additionalProperties: false,
    },
    approval: "write",
    async execute(_toolCallId, params) {
      const backups: Backup[] = [];
      try {
        if (!Array.isArray(params.edits) || params.edits.length === 0 || params.edits.length > MAX_FILES) {
          return result(`edits 必须是 1–${MAX_FILES} 项。`, { ok: false });
        }
        const allowCreate = params.allow_create === true;
        const allowOverwrite = params.allow_overwrite === true;
        const verify = params.verify === "typecheck" ? "typecheck" : "none";
        const edits: PatchEdit[] = [];
        const seenPaths = new Set<string>();
        for (const raw of params.edits) {
          if (!raw || typeof raw !== "object") throw new Error("edits 项必须是对象");
          const item = raw as Record<string, unknown>;
          const requested = typeof item.path === "string" ? item.path.trim() : "";
          if (!requested) throw new Error("edits[].path 不能为空");
          const absolute = resolveInside(cwd, requested);
          if (seenPaths.has(absolute)) throw new Error(`同一次调用不能重复编辑同一文件：${requested}`);
          seenPaths.add(absolute);
          const edit: PatchEdit = { path: absolute };
          if (typeof item.content === "string") {
            edit.content = item.content;
            if (typeof item.old_string === "string" && item.old_string.length > 0) throw new Error(`${requested}: content 与 old_string 只能二选一`);
          } else {
            if (typeof item.old_string !== "string" || !item.old_string) throw new Error(`${requested}: 缺少 old_string`);
            edit.old_string = item.old_string;
            edit.new_string = typeof item.new_string === "string" ? item.new_string : "";
            edit.replace_all = item.replace_all === true;
          }
          edits.push(edit);
        }

        // 全量预检 + 备份，任何一项不合法都不落盘。
        const planned: Array<{ absolute: string; content: string; existed: boolean }> = [];
        for (const edit of edits) {
          const backup = readBackup(edit.path);
          backups.push(backup);
          if (edit.content !== undefined) {
            if (backup.existed && !allowOverwrite) throw new Error(`${path.relative(cwd, edit.path)} 已存在；整体写入需 allow_overwrite=true`);
            if (!backup.existed && !allowCreate) throw new Error(`${path.relative(cwd, edit.path)} 不存在；创建需 allow_create=true`);
            planned.push({ absolute: edit.path, content: edit.content, existed: backup.existed });
          } else {
            if (!backup.existed) throw new Error(`${path.relative(cwd, edit.path)} 不存在，不能按 old_string 编辑`);
            planned.push({
              absolute: edit.path,
              content: replaceExact(backup.bytes ?? "", edit.old_string ?? "", edit.new_string ?? "", edit.replace_all === true),
              existed: true,
            });
          }
        }

        for (const item of planned) writeAtomic(item.absolute, item.content);

        let verification: { ok: boolean; output: string } | null = null;
        if (verify === "typecheck") {
          verification = await typecheck(cwd);
          if (!verification.ok) {
            rollback(backups);
            return result(`typecheck 失败，已回滚 ${planned.length} 个文件：\n${verification.output}`, {
              ok: false,
              rolled_back: true,
              verification,
            });
          }
        }

        const summary = planned.map((item) => `${path.relative(cwd, item.absolute)} (${item.existed ? "修改" : "新建"})`);
        return result(`已修改 ${planned.length} 个文件：\n${summary.join("\n")}`, {
          ok: true,
          files: summary,
          verification,
        });
      } catch (error) {
        if (backups.length > 0) rollback(backups);
        return result(`多文件编辑失败，已回滚：${error instanceof Error ? error.message : String(error)}`, { ok: false });
      }
    },
  };
}
