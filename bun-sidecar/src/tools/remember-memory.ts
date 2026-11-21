/**
 * tools/remember-memory.ts — remember_memory（MEM-1：三层写入）。
 *
 * 写路径要点（历史修复，勿回退）：
 *   - MEMORY-WRITE-RACE-001：写入前重读合并，缩小与后端并发读改写的丢更新窗口；
 *   - 原子写：临时文件 + rename（直接截断写在崩溃/交错时会损坏 YAML）；
 *   - 去重：同层相同 description 跳过。
 *
 * scope：
 *   persona（默认）→ config/personas/memory.yaml
 *   project       → <data>/memory/projects/<key>.yaml
 *   session       → <data>/memory/sessions/<key>.jsonl（追加事件）
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { MaxmaToolDescriptor } from "./descriptor";
import { memoryFilePath, projectMemoryDir, sessionMemoryDir, localTimestamp } from "./memory";

/** Bun.YAML 通过 globalThis 访问,避免依赖 @types/bun。 */
const bunYaml = (
  globalThis as typeof globalThis & {
    Bun: { YAML: { parse(text: string): unknown; stringify(value: unknown): string } };
  }
).Bun.YAML;

/** FNV-1a 32-bit → 8 位十六进制,与 Maxma memory.yaml 的 id 格式一致。 */
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
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 首次写入,文件尚不存在
  }
  return {};
}

async function writeDoc(file: string, document: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, bunYaml.stringify(document), "utf8");
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

function hasDuplicate(document: Record<string, unknown>, content: string): boolean {
  for (const value of Object.values(document)) {
    if (value && typeof value === "object" && (value as { description?: unknown }).description === content) return true;
  }
  return false;
}

const rememberSchema = {
  type: "object",
  properties: {
    content: {
      type: "string",
      description: "要持久化的记忆内容(事实/偏好/身份/信息)",
    },
    category: {
      type: "string",
      description: "记忆分类(如 身份/偏好/事实/瞬间)",
    },
    scope: {
      type: "string",
      enum: ["persona", "project", "session"],
      description: "写入哪一层：人格长期记忆（默认）/ 项目知识 / 会话事件",
    },
    key: {
      type: "string",
      description: "project/session 层必填：项目 key 或会话 key（字母数字 . _ -）",
    },
  },
  required: ["content"],
  additionalProperties: false,
} as const;

export function registerRememberMemoryTool(): MaxmaToolDescriptor {
  return {
    name: "remember_memory",
    label: "记住记忆",
    description:
      "当用户明确要求\"记住\"某个事实、偏好、身份、习惯或信息时，把内容持久化。默认写入人格长期记忆；scope=project 写项目知识（需要 key），scope=session 写会话事件（需要 key）。仅在用户明确要求记忆时调用。",
    parameters: rememberSchema as unknown as MaxmaToolDescriptor["parameters"],
    approval: "write",
    async execute(
      _toolCallId: string,
      params: { content: string; category?: string; scope?: string; key?: string },
    ) {
      const content = (params.content ?? "").trim();
      const category = (params.category ?? "").trim() || "其他";
      const scope = params.scope === "project" || params.scope === "session" ? params.scope : "persona";
      if (!content) {
        return { content: [{ type: "text", text: "记忆内容为空，未写入。" }], details: { stored: false, reason: "empty" } };
      }

      const id = shortHash(`${scope}:${content}`);
      const entry = { description: content, history: [], latest_update_time: localTimestamp(), theme: category };

      if (scope === "session") {
        const key = safeKey(params.key, "会话 key");
        const file = path.join(sessionMemoryDir(), `${key}.jsonl`);
        await fs.mkdir(path.dirname(file), { recursive: true });
        const existing = await fs.readFile(file, "utf8").catch(() => "");
        if (existing.includes(`"content":${JSON.stringify(content)}`)) {
          return { content: [{ type: "text", text: "该会话事件已存在,跳过重复写入。" }], details: { stored: false, reason: "duplicate" } };
        }
        await fs.appendFile(file, `${JSON.stringify({ id, content, category, updatedAt: localTimestamp() })}\n`, "utf8");
        return { content: [{ type: "text", text: `已记住（会话 ${key}）: ${content}` }], details: { stored: true, id, scope, key } };
      }

      if (scope === "project") {
        const key = safeKey(params.key, "项目 key");
        const file = path.join(projectMemoryDir(), `${key}.yaml`);
        const doc = await readDoc(file);
        if (hasDuplicate(doc, content)) {
          return { content: [{ type: "text", text: "该项目知识已存在,跳过重复写入。" }], details: { stored: false, reason: "duplicate" } };
        }
        const fresh = await readDoc(file);
        if (hasDuplicate(fresh, content)) {
          return { content: [{ type: "text", text: "该项目知识已存在,跳过重复写入。" }], details: { stored: false, reason: "duplicate" } };
        }
        fresh[id] = entry;
        await writeDoc(file, fresh);
        return { content: [{ type: "text", text: `已记住（项目 ${key}）: ${content}` }], details: { stored: true, id, scope, key } };
      }

      const file = memoryFilePath();
      const doc = await readDoc(file);
      if (hasDuplicate(doc, content)) {
        return { content: [{ type: "text", text: "该记忆已存在,跳过重复写入。" }], details: { stored: false, reason: "duplicate" } };
      }
      // MEMORY-WRITE-RACE-001：写入前重读一次再合并。
      const fresh = await readDoc(file);
      if (hasDuplicate(fresh, content)) {
        return { content: [{ type: "text", text: "该记忆已存在,跳过重复写入。" }], details: { stored: false, reason: "duplicate" } };
      }
      fresh[id] = entry;
      await writeDoc(file, fresh);
      return { content: [{ type: "text", text: `已记住: ${content}` }], details: { stored: true, id, scope } };
    },
  };
}
