/**
 * kernel/extensions/maxma-audit.ts — 工具执行审计扩展（M1 / T4）。
 *
 * 放在审批扩展之后装配：只有真正要执行的调用才会进入 tool_execution_start，
 * 因此这里不需要猜测审批结果；被路径策略/审批拒绝的调用由对应扩展直接
 * recordToolDenied，避免把“拒绝”记成“已开始”。
 */

import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { recordToolEnd, recordToolStart } from "../agent-audit";

export const MAXMA_AUDIT_EXTENSION_NAME = "maxma-audit";

export function createMaxmaAuditExtension(input: { sessionId: string; cwd: string }): InlineExtension {
  return {
    name: MAXMA_AUDIT_EXTENSION_NAME,
    factory: (pi: ExtensionAPI) => {
      pi.on("tool_execution_start", (event) => {
        const e = event as { toolName?: string; toolCallId?: string; args?: unknown };
        recordToolStart({
          sessionId: input.sessionId,
          cwd: input.cwd,
          toolName: e.toolName ?? "unknown",
          toolCallId: e.toolCallId,
          args: e.args,
        });
      });

      pi.on("tool_execution_end", (event) => {
        const e = event as { toolName?: string; toolCallId?: string; isError?: boolean; durationMs?: number; result?: unknown };
        const errorText = e.isError
          ? typeof e.result === "string"
            ? e.result
            : JSON.stringify(e.result ?? {})
          : undefined;
        recordToolEnd({
          sessionId: input.sessionId,
          toolName: e.toolName ?? "unknown",
          toolCallId: e.toolCallId,
          isError: e.isError === true,
          durationMs: typeof e.durationMs === "number" ? e.durationMs : undefined,
          errorText,
        });
      });
    },
  };
}
