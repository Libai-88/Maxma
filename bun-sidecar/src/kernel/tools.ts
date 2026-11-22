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
import { getStickerTool, learnMemeTool, memeListTool, memeUpdateTool, sendMemeTool } from "../tools/stickers";
import { searchMemoriesTool } from "../tools/memory";
import { mergeMemoriesTool } from "../tools/merge-memory";
import { browserActTool, browserNavigateTool, browserReadTool } from "../tools/browser";
import { registerRememberMemoryTool } from "../tools/remember-memory";
import { editOfficeFileTool, readOfficeFileTool, writeOfficeFileTool } from "../tools/office";
import { canvasApplyTool, canvasExportTool, canvasReadTool, type CanvasToolContext } from "../tools/canvas";
import { coworkUpdateStepsTool } from "../tools/cowork";
import { codeDefinitionTool, codeDiagnosticsTool, codeReferencesTool, codeSearchTool, codeSymbolsTool } from "../tools/code";
import { docReadTool, docSearchTool } from "../tools/doc";
import { applyPatchTool } from "../tools/patch";
import { webFetchTool, webSearchTool } from "../tools/web";

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
      const result = await descriptor.execute(toolCallId, params as Record<string, unknown>);
      // 引擎的 AgentToolResult 要求 `details` **必填**，而 descriptor 的 MaxmaToolResult
      // 里它是可选。这个差异在适配层补齐——不改 descriptor（它对引擎无知是刻意的）。
      // 顺序有意：先给默认值再展开，descriptor 真给了 details 时以它为准。
      return { details: undefined, ...result };
    },
  }) as ToolDefinition;
}

/**
 * pi 引擎的 Maxma 自定义工具集（不含已下线的 list_automations）。
 * remember_memory 的实现在 tools-remember-memory.ts（原 tools/index.ts 内联逻辑平移）。
 */
export function buildPiCustomTools(
  cwd?: string,
  /** 可选的子 Agent 工具（由 bridge 用已解析的 ModelRuntime 构造，见 kernel/subagent.ts）。 */
  extra: ToolDefinition[] = [],
  /** 画布工具需要真实会话与事件出口；缺省时不注册，避免静态/测试环境误发命令。 */
  canvas?: CanvasToolContext,
  /** Cowork 的写根与步骤事件出口；只有隔离会话需要。 */
  options?: {
    writeRoots?: string[];
    cowork?: { sessionId: string; sendEvent: CanvasToolContext["sendEvent"] };
  },
): ToolDefinition[] {
  const descriptors: MaxmaToolDescriptor[] = [
    registerRememberMemoryTool(),
    searchMemoriesTool(),
    mergeMemoriesTool(),
    browserNavigateTool(),
    browserReadTool(),
    browserActTool(),
    webSearchTool(),
    webFetchTool(),
    sendMemeTool(),
    learnMemeTool(),
    memeListTool(),
    memeUpdateTool(),
    getStickerTool(),
    listRulesTool(),
    codeSearchTool(),
    codeDefinitionTool(),
    codeReferencesTool(),
    ...(cwd ? [codeSymbolsTool(cwd), codeDiagnosticsTool(cwd), applyPatchTool(cwd)] : []),
    ...(cwd ? [docSearchTool(cwd), docReadTool(cwd)] : []),
    ...(cwd ? [readOfficeFileTool(cwd, options?.writeRoots)] : []),
    ...(cwd ? [writeOfficeFileTool(cwd, options?.writeRoots)] : []),
    ...(cwd ? [editOfficeFileTool(cwd, options?.writeRoots)] : []),
    ...(options?.cowork ? [coworkUpdateStepsTool(options.cowork)] : []),
    ...(canvas ? [
      canvasReadTool(canvas),
      canvasApplyTool(canvas),
      canvasExportTool(canvas),
    ] : []),
  ];
  return [...descriptors.map(adaptDescriptorToPi), ...extra];
}

/**
 * 会话级工具集装配：把子 Agent、Cowork 写根与步骤工具按 create_session 参数接好。
 * bridge 只保留一次调用，避免会话装配细节继续膨胀主流程。
 */
export function buildSessionCustomTools(
  cwd: string | undefined,
  subagentTool: ToolDefinition | undefined,
  session: CanvasToolContext,
  params: Record<string, unknown>,
  writeRoots?: string[],
): ToolDefinition[] {
  return buildPiCustomTools(cwd, subagentTool ? [subagentTool] : [], session, {
    ...(writeRoots !== undefined ? { writeRoots } : {}),
    ...(params.cowork === true ? { cowork: session } : {}),
  });
}
