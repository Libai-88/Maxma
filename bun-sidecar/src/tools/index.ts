/**
 * tools/index.ts — Maxma 自定义工具注册入口
 *
 * 除 OMP 原生工具外,额外注册 remember_memory:
 * 用户明确要求"记住"时,直接把内容写入 Maxma 的长期记忆文件
 * (config/personas/memory.yaml),使记忆在记忆页面可见。
 * 这绕开了 OMP 独立运行的 memory 后端(写 ~/.omp/agent/memories,
 * 与 Maxma 记忆页不互通),保证记忆落盘在便携 data 内、随程序走。
 */

import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent";

/** Bun.YAML 通过 globalThis 访问,避免依赖 @types/bun。 */
const bunYaml = (
  globalThis as typeof globalThis & {
    Bun: { YAML: { parse(text: string): unknown; stringify(value: unknown): string } };
  }
).Bun.YAML;

/**
 * remember_memory 参数 schema — 必须是「标准 JSON Schema 对象」,不能用 Zod 实例。
 *
 * 原因:Maxma 顶层 node_modules/zod 解析为 v3,而 OMP(pi-ai/pi-coding-agent)内部
 * 使用 zod v4。OMP 的 toolWireSchema 只识别 zod v4 实例(`_zod` 符号 + `.parse`)
 * 并转换为 JSON Schema;zod v3 实例不被识别,会被原样 JSON.stringify 进请求体,
 * 泄漏 `_def`/`~standard`/`_cached` 等内部字段,且缺少 `type: "object"`,
 * 导致严格校验的 OpenAI 兼容网关(如 OpenCode Zen)拒绝请求(400 invalid_request_error)。
 * 使用 plain JSON Schema 是 OMP 官方支持的一等公民(legacy + extension compat,
 * wire 层会升级到 draft 2020-12 而非转换)。
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

/** FNV-1a 32-bit → 8 位十六进制,与 Maxma memory.yaml 的 id 格式一致。 */
function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** 记忆文件路径:<MAXMA_PROJECT_ROOT>/config/personas/memory.yaml。 */
function memoryFilePath(): string {
  return path.join(
    process.env.MAXMA_PROJECT_ROOT ?? process.cwd(),
    "config",
    "personas",
    "memory.yaml",
  );
}

/** 本地时间 YYYY-MM-DD HH:MM:SS(Maxma memory.yaml 的 latest_update_time 格式)。 */
function localTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function registerCustomTools(): ToolDefinition[] {
  return [
    {
      name: "remember_memory",
      label: "记住记忆",
      description:
        "当用户明确要求\"记住\"某个事实、偏好、身份、习惯或信息时,调用本工具把该内容持久化到长期记忆文件,写入后会在记忆页面显示。仅在用户明确要求记忆时调用,不要自行推断用户意图。",
      // plain JSON Schema 对象,避免 zod v3 实例泄漏(见 rememberSchema 注释)。
      parameters: rememberSchema as unknown as ToolDefinition["parameters"],
      approval: "write",
      async execute(
        _id: string,
        params: { content: string; category?: string },
      ) {
        const content = (params.content ?? "").trim();
        const category = (params.category ?? "").trim() || "其他";
        const file = memoryFilePath();

        // 读取现有记忆文档(文件缺失按空文档处理)
        let doc: Record<string, unknown> = {};
        try {
          const raw = await fs.readFile(file, "utf8");
          const parsed = bunYaml.parse(raw);
          if (parsed && typeof parsed === "object") {
            doc = parsed as Record<string, unknown>;
          }
        } catch {
          // 首次写入,文件尚不存在
        }

        // 去重:已有相同 description 则跳过
        for (const value of Object.values(doc)) {
          if (
            value &&
            typeof value === "object" &&
            (value as { description?: unknown }).description === content
          ) {
            return {
              content: [{ type: "text", text: "该记忆已存在,跳过重复写入。" }],
              details: { stored: false, reason: "duplicate" },
            };
          }
        }

        const id = shortHash(content);
        doc[id] = {
          description: content,
          history: [],
          latest_update_time: localTimestamp(),
          theme: category,
        };
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, bunYaml.stringify(doc), "utf8");

        return {
          content: [{ type: "text", text: `已记住: ${content}` }],
          details: { stored: true, id },
        };
      },
    },
  ] as unknown as ToolDefinition[];
}
