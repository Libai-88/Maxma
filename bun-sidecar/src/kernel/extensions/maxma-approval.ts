/**
 * kernel/extensions/maxma-approval.ts — 工具审批扩展（阶段一 §6.2 任务 2）。
 *
 * 机制完全采用 pi 官方扩展模式（pi.dev/docs/latest/extensions 官方示例原文结构）：
 *   pi.on("tool_call", async (event) => { ... return { block: true, reason } })
 * 注解判定沿用官方示例的 getAllTools().find(...).annotations 读取方式。
 *
 * 取代 OMP 时代的两条弯路：
 *   - OMP 审批靠 ExtensionUIContext ctx.select("Allow tool: ...") 标题字符串，
 *     bridge 需 parseApprovalTitle 反解析 toolName/args（approval.ts）；
 *   - MaxmaBlocker 靠订阅层事件 abort（blocker.ts，存在部分副作用）。
 * pi 的结构化 tool_call 钩子在执行前 block，两者合一，无部分副作用。
 */

import type { ExtensionAPI, InlineExtension, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import type { ApprovalGate } from "../types";

/** 审批扩展名（官方 InlineExtension.name，诊断与启动清单可见）。 */
export const MAXMA_APPROVAL_EXTENSION_NAME = "maxma-approval";

/**
 * 创建审批扩展。gate 由 bridge 提供：
 *   - needsApproval：按 MaxmaPermissionMode 4 档 + 官方注解判定，纯同步；
 *   - decide：等待前端 user_response 应答（超时默认拒绝）。
 * 门不提供时不应装配本扩展（pi-session.ts 保证）。
 */
export function createMaxmaApprovalExtension(gate: ApprovalGate): InlineExtension {
  return {
    name: MAXMA_APPROVAL_EXTENSION_NAME,
    factory: (pi: ExtensionAPI) => {
      pi.on("tool_call", async (event: ToolCallEvent): Promise<ToolCallEventResult | undefined> => {
        // 官方示例同款注解读取：工具注解决定默认审批倾向
        const annotations = pi
          .getAllTools()
          .find((tool: { name: string }) => tool.name === event.toolName)?.annotations as
          | Record<string, unknown>
          | undefined;

        const input = (event as { input?: Record<string, unknown> }).input ?? {};
        const toolCallId = event.toolCallId;

        if (!gate.needsApproval({ toolName: event.toolName, annotations })) {
          return undefined; // 官方约定：返回 undefined 即放行
        }
        const decision = await gate.decide({ toolName: event.toolName, toolCallId, input, annotations });
        if (!decision.approved) {
          return { block: true, reason: decision.reason ?? `${event.toolName} was not approved` };
        }
        return undefined;
      });
    },
  };
}
