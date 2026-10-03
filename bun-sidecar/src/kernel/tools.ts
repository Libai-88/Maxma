/**
 * kernel/tools.ts — Maxma 自定义工具 → pi 官方工具适配（阶段一 §6.2 任务 5）。
 *
 * 工具实现（src/tools/*）与引擎解耦：descriptor（plain JSON Schema + approval 倾向）
 * 在此适配为官方 `defineTool`：
 *   - parameters：`Type.Unsafe(descriptor.parameters)` —— 官方 TypeBox API，
 *     直接包装 plain JSON Schema，避免 schema 双写
 *   - approval → 官方 annotations：read → { readOnlyHint: true }；write → { readOnlyHint: false }
 *     （审批门据此判定；与 OMP 的 approval 字段语义一致）
 *   - execute 签名适配：官方 execute(toolCallId, params, signal, onUpdate, ctx) →
 *     Maxma execute(toolCallId, params)（本组工具不消费 signal/onUpdate/ctx）
 *
 * 名单按 §7.5 处置清单：4 个（remember_memory / search_memories / get_sticker /
 * list_rules）；list_automations 随 automation 下线决策不进 pi 引擎。
 */

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type { MaxmaToolDescriptor } from "../tools/descriptor";
import { listRulesTool } from "../tools/rules";
import { getStickerTool } from "../tools/stickers";
import { searchMemoriesTool } from "../tools/memory";
import { registerRememberMemoryTool } from "../tools/remember-memory";
import { readOfficeFileTool, writeOfficeFileTool } from "../tools/office";

/** OMP approval 字段 → 官方 ToolAnnotations（审批门 needsApprovalForMode 消费）。 */
function annotationsFor(approval: MaxmaToolDescriptor["approval"]): ToolDefinition["annotations"] {
  return approval === "read" ? { readOnlyHint: true } : { readOnlyHint: false };
}

/** 单个 descriptor → 官方 ToolDefinition（TypeBox parameters + annotations + 签名适配）。 */
export function adaptDescriptorToPi(descriptor: MaxmaToolDescriptor): ToolDefinition {
  return defineTool({
    name: descriptor.name,
    label: descriptor.label,
    description: descriptor.description,
    parameters: Type.Unsafe(descriptor.parameters) as ToolDefinition["parameters"],
    annotations: annotationsFor(descriptor.approval),
    async execute(toolCallId, params) {
      // Maxma 执行体不消费 signal/onUpdate/ctx（纯读写本地文件）
      return await descriptor.execute(toolCallId, params as Record<string, unknown>);
    },
  }) as ToolDefinition;
}

/**
 * pi 引擎的 Maxma 自定义工具集（不含已下线的 list_automations）。
 * remember_memory 的实现在 tools-remember-memory.ts（原 tools/index.ts 内联逻辑平移）。
 */
export function buildPiCustomTools(cwd?: string): ToolDefinition[] {
  const descriptors: MaxmaToolDescriptor[] = [
    registerRememberMemoryTool(),
    searchMemoriesTool(),
    getStickerTool(),
    listRulesTool(),
    ...(cwd ? [readOfficeFileTool(cwd)] : []),
    ...(cwd ? [writeOfficeFileTool(cwd)] : []),
  ];
  return descriptors.map(adaptDescriptorToPi);
}
