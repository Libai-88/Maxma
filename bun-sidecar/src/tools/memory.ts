/**
 * tools/memory.ts — Maxma 记忆检索工具（MEM-1：三层）。
 *
 * 三个真实存储层：
 *   persona → <project>/config/personas/memory.yaml（原有）
 *   project → <data>/memory/projects/<key>.yaml
 *   session → <data>/memory/sessions/<key>.jsonl
 *
 * search_memories 默认 all；每条结果带层标签。BM25/去重/冲突提示沿用
 * memory/search.ts，不为分层另造一套评分。
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { MaxmaToolDescriptor } from "./descriptor";
import { maxmaDataRoot, maxmaProjectRoot } from "../kernel/project-paths";
import { searchMemoryEntries, type MemoryEntry as RankedEntry } from "../memory/search";

/** Bun.YAML 通过 globalThis 访问，避免依赖 @types/bun。 */
const bunYaml = (
  globalThis as typeof globalThis & {
    Bun: { YAML: { parse(text: string): unknown; stringify(value: unknown): string } };
  }
).Bun.YAML;

/** 人格记忆路径：<MAXMA_PROJECT_ROOT>/config/personas/memory.yaml。 */
export function memoryFilePath(): string {
  return path.join(
    maxmaProjectRoot(),
    "config",
    "personas",
    "memory.yaml",
  );
}

export function projectMemoryDir(): string {
  return path.join(maxmaDataRoot(), "memory", "projects");
}

export function sessionMemoryDir(): string {
  return path.join(maxmaDataRoot(), "memory", "sessions");
}

export type MemoryScope = "persona" | "project" | "session";

export interface MemoryEntry extends RankedEntry {
  scope?: MemoryScope;
  /** 项目/会话文件名。 */
  source?: string;
}

function localTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export { localTimestamp };

function normalizeDocEntries(document: Record<string, unknown>, scope: MemoryScope, source?: string): MemoryEntry[] {
  return Object.entries(document)
    .map(([id, value]) => {
      const v = (value ?? {}) as { description?: unknown; content?: unknown; theme?: unknown; category?: unknown; latest_update_time?: unknown };
      return {
        id,
        description: typeof v.description === "string" ? v.description : typeof v.content === "string" ? v.content : "",
        category: typeof v.theme === "string" ? v.theme : typeof v.category === "string" ? v.category : "其他",
        updatedAt: typeof v.latest_update_time === "string" ? v.latest_update_time : "",
        scope,
        ...(source ? { source } : {}),
      };
    })
    .filter((m) => m.description !== "");
}

async function readYaml(file: string, scope: MemoryScope, source?: string): Promise<MemoryEntry[]> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = bunYaml.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return normalizeDocEntries(parsed as Record<string, unknown>, scope, source);
    }
  } catch {
    /* 文件不存在 */
  }
  return [];
}

async function readSessionEvents(file: string, source: string): Promise<MemoryEntry[]> {
  const out: MemoryEntry[] = [];
  try {
    const raw = await fs.readFile(file, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (typeof event.content !== "string" || !event.content.trim()) continue;
        out.push({
          id: typeof event.id === "string" ? event.id : `${source}-${out.length}`,
          description: event.content,
          category: typeof event.category === "string" ? event.category : "事件",
          updatedAt: typeof event.updatedAt === "string" ? event.updatedAt : "",
          scope: "session",
          source,
        });
      } catch {
        // 单行坏数据跳过
      }
    }
  } catch {
    /* 文件不存在 */
  }
  return out;
}

/** 读取记忆文档，返回条目列表（按更新时间倒序）。 */
export async function readMemories(scope: MemoryScope | "all" = "all"): Promise<MemoryEntry[]> {
  const entries: MemoryEntry[] = [];
  if (scope === "persona" || scope === "all") {
    entries.push(...await readYaml(memoryFilePath(), "persona"));
  }
  if (scope === "project" || scope === "all") {
    try {
      const files = (await fs.readdir(projectMemoryDir())).filter((name) => name.endsWith(".yaml") && !name.includes(".tmp"));
      for (const name of files.sort()) {
        entries.push(...await readYaml(path.join(projectMemoryDir(), name), "project", name.slice(0, -5)));
      }
    } catch {
      /* 目录不存在 */
    }
  }
  if (scope === "session" || scope === "all") {
    try {
      const files = (await fs.readdir(sessionMemoryDir())).filter((name) => name.endsWith(".jsonl"));
      for (const name of files.sort()) {
        entries.push(...await readSessionEvents(path.join(sessionMemoryDir(), name), name.slice(0, -6)));
      }
    } catch {
      /* 目录不存在 */
    }
  }
  return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

const searchMemoriesSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "检索关键词，匹配记忆内容（留空返回全部记忆）",
    },
    category: {
      type: "string",
      description: "按记忆分类过滤（如 身份/偏好/事实/其他）",
    },
    scope: {
      type: "string",
      enum: ["all", "persona", "project", "session"],
      description: "记忆层：人格长期记忆 / 项目知识 / 会话事件；默认 all",
    },
    limit: {
      type: "number",
      description: "返回条数上限（默认 10，最大 50）",
    },
  },
  additionalProperties: false,
} as const;

function scopeLabel(scope: MemoryScope | undefined, source?: string): string {
  if (scope === "project") return `项目${source ? `:${source}` : ""}`
  if (scope === "session") return `会话${source ? `:${source}` : ""}`
  return "人格"
}

export function searchMemoriesTool(): MaxmaToolDescriptor {
  return {
    name: "search_memories",
    label: "检索记忆",
    description:
      "检索长期记忆。默认同时搜三层：人格记忆（跨项目事实/偏好）、项目知识（按项目 key 分文件）、会话事件（按会话 key 记录）。返回匹配条目并标注层与来源。",
    parameters: searchMemoriesSchema as unknown as MaxmaToolDescriptor["parameters"],
    approval: "read",
    async execute(_id: string, params: { query?: string; category?: string; scope?: MemoryScope | "all"; limit?: number }) {
      const memories = await readMemories(params.scope ?? "all");
      const filtered = params.category
        ? memories.filter((entry) => entry.category === params.category)
        : memories;
      const result = searchMemoryEntries(filtered, { ...params, category: undefined });
      if (result.returned.length === 0) {
        return {
          content: [{ type: "text", text: "没有找到匹配的记忆。" }],
          details: { total: 0, returned: 0, duplicateGroups: [], possibleConflicts: [] },
        };
      }

      const lines = result.returned.map((m) => {
        const entry = m as MemoryEntry
        return `- [${scopeLabel(entry.scope, entry.source)}] [${m.id}] (${m.category}) ${m.description}${m.updatedAt ? ` [更新于 ${m.updatedAt}]` : ""}`
      });
      const notes: string[] = [];
      if (result.duplicateGroups.length > 0) {
        notes.push(`注意：${result.duplicateGroups.length} 组记忆内容高度重复，可考虑用 merge_memories 合并（${result.duplicateGroups.map((g) => g.ids.join("/")).join("；")}）。`);
      }
      if (result.possibleConflicts.length > 0) {
        notes.push(`注意：${result.possibleConflicts.length} 组记忆可能冲突，请以最新时间和用户当前表述为准；裁决后可把结论写入 merge_memories 的 reason（${result.possibleConflicts.map((g) => g.ids.join("/")).join("；")}）。`);
      }
      return {
        content: [{
          type: "text",
          text: `找到 ${result.total} 条记忆（显示前 ${result.returned.length} 条）：\n${lines.join("\n")}${notes.length > 0 ? `\n\n${notes.join("\n")}` : ""}`,
        }],
        details: {
          total: result.total,
          returned: result.returned.length,
          duplicateGroups: result.duplicateGroups,
          possibleConflicts: result.possibleConflicts,
        },
      };
    },
  };
}

export interface MergeCandidate {
  id: string;
  description: string;
  category: string;
  updatedAt: string;
}

/** 供 merge_memories 复用：读某一层的原始条目（不做检索排序）。 */
export async function readMemoryLayer(scope: MemoryScope, key?: string): Promise<MergeCandidate[]> {
  if (scope === "persona") {
    const entries = await readYaml(memoryFilePath(), "persona");
    return entries.map(({ id, description, category, updatedAt }) => ({ id, description, category, updatedAt }));
  }
  if (scope === "project") {
    if (!key) throw new Error("project 层需要 key");
    const entries = await readYaml(path.join(projectMemoryDir(), `${key}.yaml`), "project", key);
    return entries.map(({ id, description, category, updatedAt }) => ({ id, description, category, updatedAt }));
  }
  if (!key) throw new Error("session 层需要 key");
  const entries = await readSessionEvents(path.join(sessionMemoryDir(), `${key}.jsonl`), key);
  return entries.map(({ id, description, category, updatedAt }) => ({ id, description, category, updatedAt }));
}
