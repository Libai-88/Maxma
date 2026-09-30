/**
 * tools/remember-memory.ts — remember_memory 工具实现（OMP 依赖解除：逻辑从
 * tools/index.ts 内联平移为 descriptor，两端共用，单一事实源）。
 *
 * 写路径要点（历史修复，勿回退）：
 *   - MEMORY-WRITE-RACE-001：写入前重读合并，缩小与 Python 后端并发读改写的
 *     丢更新窗口；
 *   - 原子写：临时文件 + rename（直接截断写在崩溃/交错时会损坏 YAML，
 *     导致记忆页面 503、Agent 读空）；
 *   - 去重：相同 description 跳过（读两次：读入与写入前各一次）。
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { MaxmaToolDescriptor } from "./descriptor";
import { memoryFilePath } from "./memory";

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

/** 本地时间 YYYY-MM-DD HH:MM:SS(Maxma memory.yaml 的 latest_update_time 格式)。 */
function localTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * remember_memory 参数 schema — 必须是「标准 JSON Schema 对象」,不能用 Zod 实例。
 *
 * 原因:Maxma 顶层 node_modules/zod 解析为 v3,而 OMP(pi-ai/pi-coding-agent)内部
 * 使用 zod v4。OMP 的 toolWireSchema 只识别 zod v4 实例(`_zod` 符号 + `.parse`)
 * 并转换为 JSON Schema;zod v3 实例不被识别,会被原样 JSON.stringify 进请求体,
 * 泄漏 `_def`/`~standard`/`_cached` 等内部字段,且缺少 `type: "object"`,
 * 导致严格校验的 OpenAI 兼容网关(如 OpenCode Zen)拒绝请求(400 invalid_request_error)。
 * plain JSON Schema 是两端(OMP legacy + pi Type.Unsafe)的一等公民。
 */
const rememberSchema = {
  type: "object",
  properties: {
    content: {
      type: "string",
      description: "要持久化的长期记忆内容(事实/偏好/身份/信息)",
    },
    category: {
      type: "string",
      description: "记忆分类(如 身份/偏好/事实/瞬间)",
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
      "当用户明确要求\"记住\"某个事实、偏好、身份、习惯或信息时,调用本工具把该内容持久化到长期记忆文件,写入后会在记忆页面显示。仅在用户明确要求记忆时调用,不要自行推断用户意图。",
    parameters: rememberSchema as unknown as MaxmaToolDescriptor["parameters"],
    approval: "write",
    async execute(
      _toolCallId: string,
      params: { content: string; category?: string },
    ) {
      const content = (params.content ?? "").trim();
      const category = (params.category ?? "").trim() || "其他";
      const file = memoryFilePath();

      // 读取现有记忆文档(文件缺失按空文档处理)
      const readDoc = async (): Promise<Record<string, unknown>> => {
        try {
          const raw = await fs.readFile(file, "utf8");
          const parsed = bunYaml.parse(raw);
          if (parsed && typeof parsed === "object") {
            return parsed as Record<string, unknown>;
          }
        } catch {
          // 首次写入,文件尚不存在
        }
        return {};
      };

      // 去重:已有相同 description 则跳过
      const hasDuplicate = (d: Record<string, unknown>): boolean => {
        for (const value of Object.values(d)) {
          if (
            value &&
            typeof value === "object" &&
            (value as { description?: unknown }).description === content
          ) {
            return true;
          }
        }
        return false;
      };

      const doc = await readDoc();
      if (hasDuplicate(doc)) {
        return {
          content: [{ type: "text" as const, text: "该记忆已存在,跳过重复写入。" }],
          details: { stored: false, reason: "duplicate" },
        };
      }

      const id = shortHash(content);
      const entry = {
        description: content,
        history: [],
        latest_update_time: localTimestamp(),
        theme: category,
      };

      // MEMORY-WRITE-RACE-001：写入前重读一次并与最新磁盘状态合并，
      // 缩小与 Python 后端（memory.py UI 增删改）并发读改写之间的丢更新窗口。
      const fresh = await readDoc();
      if (hasDuplicate(fresh)) {
        return {
          content: [{ type: "text" as const, text: "该记忆已存在,跳过重复写入。" }],
          details: { stored: false, reason: "duplicate" },
        };
      }
      fresh[id] = entry;

      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, bunYaml.stringify(fresh), "utf8");
      try {
        await fs.rename(tmp, file);
      } catch (err) {
        await fs.rm(tmp, { force: true }).catch(() => {});
        throw err;
      }

      return {
        content: [{ type: "text" as const, text: `已记住: ${content}` }],
        details: { stored: true, id },
      };
    },
  };
}
