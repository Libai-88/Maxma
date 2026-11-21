/**
 * kernel/extensions/maxma-hooks.ts — 把已签名的用户钩子挂到 pi 生命周期（A4）。
 *
 * 顺序很重要：本扩展必须**排在 maxma-blocker / maxma-path-policy 之前**。
 * 钩子可以改写工具入参；如果先过路径策略再改写，改写就会绕开 PathPolicy。
 * 现在的链路是：
 *   hooks(PreToolUse) → blocker → path-policy → approval → audit → tool
 * 因此钩子改出来的路径仍会被路径策略重新检查。
 */

import type {
  ExtensionAPI,
  InlineExtension,
  SessionBeforeCompactEvent,
  SessionBeforeCompactResult,
  SessionShutdownEvent,
  SessionStartEvent,
  ToolCallEvent,
  ToolCallEventResult,
  ToolResultEvent,
  ToolResultEventResult,
} from "@earendil-works/pi-coding-agent";

import { summarizeInput } from "../agent-audit";
import { recordHookRun } from "../hooks/audit";
import { runHooks } from "../hooks/runner";
import type { HookDefinition } from "../hooks/hook-types";

export const MAXMA_HOOKS_EXTENSION_NAME = "maxma-hooks";

export interface MaxmaHooksOptions {
  sessionId: string;
  cwd: string;
  hooks: HookDefinition[];
}

function resultText(event: ToolResultEvent): string {
  const blocks = Array.isArray(event.content) ? event.content : [];
  return blocks
    .filter((block): block is { type: "text"; text: string } => Boolean(block) && block.type === "text" && typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text)
    .join("\n")
    .slice(0, 4_000);
}

export function createMaxmaHooksExtension(options: MaxmaHooksOptions): InlineExtension {
  return {
    name: MAXMA_HOOKS_EXTENSION_NAME,
    factory: (pi: ExtensionAPI) => {
      if (options.hooks.length === 0) return;

      pi.on("tool_call", async (event: ToolCallEvent): Promise<ToolCallEventResult | undefined> => {
        const input = (event as { input?: Record<string, unknown> }).input ?? {};
        const run = await runHooks(options.hooks, {
          event: "PreToolUse",
          sessionId: options.sessionId,
          cwd: options.cwd,
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          input,
        });
        recordHookRun({
          sessionId: options.sessionId,
          toolName: event.toolName,
          summary: summarizeInput(input),
          records: run.records,
        });
        if (run.decision.block) {
          return { block: true, reason: run.decision.reason ?? "钩子拒绝该工具调用" };
        }
        if (run.decision.inputPatch && input && typeof input === "object") {
          Object.assign(input, run.decision.inputPatch);
        }
        return undefined;
      });

      pi.on("tool_result", async (event: ToolResultEvent): Promise<ToolResultEventResult | undefined> => {
        const run = await runHooks(options.hooks, {
          event: "PostToolUse",
          sessionId: options.sessionId,
          cwd: options.cwd,
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          input: event.input,
          result: { isError: event.isError, text: resultText(event) },
        });
        recordHookRun({
          sessionId: options.sessionId,
          toolName: event.toolName,
          records: run.records,
        });
        if (!run.decision.contentAppend) return undefined;
        const blocks = Array.isArray(event.content) ? event.content : [];
        return {
          content: [...blocks, { type: "text", text: run.decision.contentAppend }],
        };
      });

      pi.on("session_start", async (event: SessionStartEvent) => {
        const run = await runHooks(options.hooks, {
          event: "SessionStart",
          sessionId: options.sessionId,
          cwd: options.cwd,
          extra: { reason: event.reason },
        });
        recordHookRun({ sessionId: options.sessionId, records: run.records });
        if (run.decision.additionalContext) {
          pi.sendMessage({
            customType: "maxma-hook-context",
            content: run.decision.additionalContext,
            display: true,
            details: { source: "SessionStart" },
          });
        }
      });

      pi.on("session_before_compact", async (event: SessionBeforeCompactEvent): Promise<SessionBeforeCompactResult | undefined> => {
        const run = await runHooks(options.hooks, {
          event: "PreCompact",
          sessionId: options.sessionId,
          cwd: options.cwd,
          extra: { reason: event.reason, willRetry: event.willRetry },
        });
        recordHookRun({ sessionId: options.sessionId, records: run.records });
        if (run.decision.cancel) return { cancel: true };
        if (run.decision.customInstructions) {
          event.customInstructions = [event.customInstructions, run.decision.customInstructions].filter(Boolean).join("\n\n");
        }
        return undefined;
      });

      pi.on("session_shutdown", async (event: SessionShutdownEvent) => {
        const run = await runHooks(options.hooks, {
          event: "SessionEnd",
          sessionId: options.sessionId,
          cwd: options.cwd,
          extra: { reason: event.reason },
        });
        recordHookRun({ sessionId: options.sessionId, records: run.records });
      });
    },
  };
}
