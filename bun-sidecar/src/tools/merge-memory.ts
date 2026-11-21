/**
 * tools/merge-memory.ts — 记忆合并/冲突裁决（MEM-1）。
 *
 * 为什么需要它：search_memories 会提示"可能冲突/重复"，但只提示不处理，
 * 用户下次还会搜到互相矛盾的两条。合并把旧条目的原文放进新条目的 history，
 * 并把裁决理由写入 `<data>/memory/conflicts.jsonl`，之后可以追溯"为什么删了它"。
 *
 * 边界：
 *   - 只合并 persona / project 两层（会话事件是时间流，不做合并）；
 *   - 至少 2 个、最多 10 个 id；必须全部存在，否则整次拒绝；
 *   - 新内容默认由旧描述用分号连接；也可以显式给 content；
 *   - 写入仍走临时文件 + rename。
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { MaxmaToolDescriptor } from "./descriptor";
import { maxmaDataRoot } from "../kernel/project-paths";
import { memoryFilePath, projectMemoryDir, readMemoryLayer, localTimestamp } from "./memory";

const bunYaml = (
  globalThis as typeof globalThis & {
    Bun: { YAML: { parse(text: string): unknown; stringify(value: unknown): string } };
  }
).Bun.YAML;

function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function safeKey(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9._-]{1,80}$/.test(value.trim())) {
    throw new Error(`${label} 只允许字母数字 . _ -（最多 80 字符）`);
  }
  return value.trim();
}

async function readDoc(file: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = bunYaml.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* 不存在 */ }
  return {};
}

async function writeDoc(file: string, document: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, bunYaml.stringify(document), "utf8");
  try {
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

const mergeSchema = {
  type: "object",
  properties: {
    ids: {
      type: "array",
      items: { type: "string" },
      minItems: 2,
      maxItems: 10,
      description: "要合并的记忆 id（2–10 个），必须全部存在",
    },
    content: {
      type: "string",
      description: "合并后的内容；省略则用旧描述以“；”连接",
    },
    category: {
      type: "string",
      description: "合并后的分类；省略沿用第一条的分类",
    },
    reason: {
      type: "string",
      description: "裁决理由（写入冲突日志，便于回溯）",
    },
    scope: {
      type: "string",
      enum: ["persona", "project"],
      description: "记忆层，默认 persona",
    },
    key: {
      type: "string",
      description: "project 层必填：项目 key",
    },
  },
  required: ["ids", "reason"],
  additionalProperties: false,
} as const;

export function mergeMemoriesTool(): MaxmaToolDescriptor {
  return {
    name: "merge_memories",
    label: "合并记忆",
    description:
      "把 2–10 条重复或冲突的记忆合并成一条，旧内容保存在新条目的 history 里，裁决理由写入冲突日志。只在用户确认合并/裁决或你已明确说明时调用。",
    parameters: mergeSchema as unknown as MaxmaToolDescriptor["parameters"],
    approval: "write",
    async execute(
      _toolCallId: string,
      params: { ids: string[]; content?: string; category?: string; reason: string; scope?: string; key?: string },
    ) {
      const ids = [...new Set((params.ids ?? []).filter((id) => typeof id === "string" && id.trim()))];
      const reason = (params.reason ?? "").trim();
      if (ids.length < 2) return { content: [{ type: "text", text: "合并至少需要 2 条记忆。" }], details: { merged: false, reason: "too_few" } };
      if (!reason) return { content: [{ type: "text", text: "必须提供 reason（裁决理由）。" }], details: { merged: false, reason: "missing_reason" } };
      const scope = params.scope === "project" ? "project" : "persona";

      let file: string;
      let key: string | undefined;
      try {
        key = scope === "project" ? safeKey(params.key, "项目 key") : undefined;
        file = scope === "project" ? path.join(projectMemoryDir(), `${key}.yaml`) : memoryFilePath();
        const candidates = await readMemoryLayer(scope, key);
        const byId = new Map(candidates.map((entry) => [entry.id, entry]));
        const missing = ids.filter((id) => !byId.has(id));
        if (missing.length > 0) {
          return {
            content: [{ type: "text", text: `以下 id 不存在，未合并：${missing.join("、")}` }],
            details: { merged: false, reason: "missing_ids", missing },
          };
        }
        const selected = ids.map((id) => byId.get(id)!);
        const mergedContent = (params.content ?? "").trim() || selected.map((entry) => entry.description).join("；");
        const category = (params.category ?? "").trim() || selected[0]!.category;
        const newId = shortHash(`merge:${mergedContent}:${ids.join(",")}`);
        const document = await readDoc(file);
        const history = selected.map((entry) => ({
          id: entry.id,
          description: entry.description,
          category: entry.category,
          updatedAt: entry.updatedAt,
        }));
        for (const id of ids) delete document[id];
        document[newId] = {
          description: mergedContent,
          theme: category,
          latest_update_time: localTimestamp(),
          history: [{ merged_from: ids, reason, at: localTimestamp(), previous: history }],
        };
        await writeDoc(file, document);
        await fs.mkdir(path.join(maxmaDataRoot(), "memory"), { recursive: true });
        await fs.appendFile(
          path.join(maxmaDataRoot(), "memory", "conflicts.jsonl"),
          `${JSON.stringify({ timestamp: new Date().toISOString(), action: "merge", scope, key, ids, kept: newId, reason, content: mergedContent })}\n`,
          "utf8",
        );
        return {
          content: [{ type: "text", text: `已合并 ${ids.length} 条记忆为 [${newId}]：${mergedContent}` }],
          details: { merged: true, id: newId, ids, scope, key, reason },
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `合并失败：${error instanceof Error ? error.message : String(error)}` }],
          details: { merged: false, reason: "error" },
        };
      }
    },
  };
}
