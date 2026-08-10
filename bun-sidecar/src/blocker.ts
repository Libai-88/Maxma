/**
 * blocker.ts — MaxmaBlocker 拒止锚执行拦截（BLOCKER-ENFORCE-001）。
 *
 * 此前 MaxmaBlocker 只在 REST 层提供 check-path-blocked（前端附件气泡
 * 标红），"AI 文件类工具无法读写受保护目录"的承诺无任何执行代码——
 * agent 的文件工具照常读写。本模块在 sidecar 订阅层实现执行拦截：
 * 文件类工具执行开始时解析参数中的路径，向上遍历父目录查找
 * `.maxma_blocker` 标记文件（与 api/routes/maxma_blocker.py 的
 * _find_blocker_path 同一约定），命中即发 error + done 并 abort 本轮。
 *
 * 说明：拦截发生在工具执行开始事件（OMP 语义为执行启动时），
 * abort 中断后续执行；写入类工具在拦截前可能已有部分副作用，但
 * 读/写/编辑等主流工具调用会被及时打断并给出明确错误。
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** 拒止锚标记文件名 — 必须与 api/routes/maxma_blocker.py 的 BLOCKER_FILENAME 一致 */
export const BLOCKER_FILENAME = ".maxma_blocker";

/** 文件/目录类工具名提示（命中才做路径检查，避免对每个工具做文件系统遍历） */
const FILE_TOOL_HINTS = /(?:file|write|edit|read|mkdir|rmdir|rename|delete|copy|move|bash|exec|cd)/i;

/** 常见路径参数键（OMP 文件工具参数名集合） */
const PATH_KEYS = ["file_path", "filePath", "path", "file", "filename", "directory", "cwd", "dir"];

/**
 * 向上遍历路径及其所有父目录，查找 `.maxma_blocker` 标记。
 * 命中返回标记所在目录；未命中/路径非法返回 null（fail-open 由调用方决定）。
 */
export function findBlockerPath(p: string): string | null {
  try {
    let cur = path.resolve(p);
    while (true) {
      if (fs.existsSync(path.join(cur, BLOCKER_FILENAME))) {
        return cur;
      }
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  } catch {
    // 路径非法（空/控制字符等）——不阻断，交给工具自身处理
  }
  return null;
}

/** 从工具参数对象中提取候选路径（仅常见路径键的字符串值）。 */
export function extractPaths(args: unknown): string[] {
  if (!args || typeof args !== "object" || Array.isArray(args)) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (PATH_KEYS.includes(key) && typeof value === "string" && value.trim()) {
      out.push(value.trim());
    }
  }
  return out;
}

/** 检查工具调用是否命中拒止锚；命中返回阻断信息，未命中返回 null。 */
export function checkToolBlocked(toolName: string, args: unknown): { blockerPath: string; toolPath: string } | null {
  if (!FILE_TOOL_HINTS.test(toolName ?? "")) return null;
  for (const p of extractPaths(args)) {
    const blockerPath = findBlockerPath(p);
    if (blockerPath !== null) {
      return { blockerPath, toolPath: p };
    }
  }
  return null;
}
