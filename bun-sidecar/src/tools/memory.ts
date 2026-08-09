/**
 * tools/memory.ts — Maxma 记忆检索工具。
 *
 * search_memories：读取 config/personas/memory.yaml，按关键词过滤返回
 * 记忆条目，使 Agent 能回忆 Maxma 记忆页中用户明确要求记住的内容。
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";

/** Bun.YAML 通过 globalThis 访问，避免依赖 @types/bun。 */
const bunYaml = (
  globalThis as typeof globalThis & {
    Bun: { YAML: { parse(text: string): unknown; stringify(value: unknown): string } };
  }
).Bun.YAML;

/** 记忆文件路径：<MAXMA_PROJECT_ROOT>/config/personas/memory.yaml。 */
export function memoryFilePath(): string {
  return path.join(
    process.env.MAXMA_PROJECT_ROOT ?? process.cwd(),
    "config",
    "personas",
    "memory.yaml",
  );
}

interface MemoryEntry {
  id: string;
  description: string;
  category: string;
  updatedAt: string;
}

/** 读取记忆文档，返回条目列表（按更新时间倒序）。 */
export async function readMemories(): Promise<MemoryEntry[]> {
  const file = memoryFilePath();
  let doc: Record<string, unknown> = {};
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = bunYaml.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      doc = parsed as Record<string, unknown>;
    }
  } catch {
    return []; // 尚无记忆文件
  }

  return Object.entries(doc)
    .map(([id, value]) => {
      const v = (value ?? {}) as {
        description?: unknown;
        theme?: unknown;
        latest_update_time?: unknown;
      };
      return {
        id,
        description: typeof v.description === "string" ? v.description : "",
        category: typeof v.theme === "string" ? v.theme : "其他",
        updatedAt: typeof v.latest_update_time === "string" ? v.latest_update_time : "",
      };
    })
    .filter((m) => m.description !== "")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
    limit: {
      type: "number",
      description: "返回条数上限（默认 10，最大 50）",
    },
  },
  additionalProperties: false,
} as const;

export function searchMemoriesTool(): ToolDefinition {
  return {
    name: "search_memories",
    label: "检索记忆",
    description:
      "检索用户长期记忆中明确记住的事实、偏好、身份、习惯等信息。当对话需要回忆用户之前要求记住的内容时调用（例如用户说\"我之前让你记住的...\"）。返回匹配的记忆条目；无匹配时返回空。",
    parameters: searchMemoriesSchema as unknown as ToolDefinition["parameters"],
    approval: "read",
    async execute(_id: string, params: { query?: string; category?: string; limit?: number }) {
      const memories = await readMemories();
      const query = (params.query ?? "").trim().toLowerCase();
      const category = (params.category ?? "").trim();
      const limit = Math.min(Math.max(Math.floor(params.limit ?? 10), 1), 50);

      let matched = memories;
      if (category) matched = matched.filter((m) => m.category === category);
      if (query) matched = matched.filter((m) => m.description.toLowerCase().includes(query));

      const top = matched.slice(0, limit);
      if (top.length === 0) {
        return {
          content: [{ type: "text", text: "没有找到匹配的记忆。" }],
          details: { total: 0 },
        };
      }

      const lines = top.map(
        (m) => `- [${m.id}] (${m.category}) ${m.description}${m.updatedAt ? ` [更新于 ${m.updatedAt}]` : ""}`,
      );
      return {
        content: [{ type: "text", text: `找到 ${matched.length} 条记忆（显示前 ${top.length} 条）：\n${lines.join("\n")}` }],
        details: { total: matched.length, returned: top.length },
      };
    },
  };
}
