/**
 * kernel/extensions/maxma-blocker.ts — MaxmaBlocker 拒止锚扩展（阶段一 §6.2 任务 3）。
 *
 * 官方 tool_call 钩子模式（同 maxma-approval）：执行前 block，命中拒止锚的
 * 调用不会产生任何部分副作用（优于 OMP 时代的事件层 abort——工具已开跑）。
 * 路径解析/父目录遍历复用 src/blocker.ts 的纯函数（与 api/routes/maxma_blocker.py
 * 同一 BLOCKER_FILENAME 约定），零逻辑分叉。
 *
 * 拦截语义（按方案 §3.2 已确认）：block 单次调用并把原因回给 agent
 * （官方 ToolCallEventResult），agent 可改道；整轮不中断。
 */

import type { ExtensionAPI, InlineExtension, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { checkToolBlocked } from "../../blocker";

export const MAXMA_BLOCKER_EXTENSION_NAME = "maxma-blocker";

export function createMaxmaBlockerExtension(): InlineExtension {
  return {
    name: MAXMA_BLOCKER_EXTENSION_NAME,
    factory: (pi: ExtensionAPI) => {
      pi.on("tool_call", async (event: ToolCallEvent): Promise<ToolCallEventResult | undefined> => {
        const input = (event as { input?: Record<string, unknown> }).input ?? {};
        const blocked = checkToolBlocked(event.toolName, input);
        if (blocked) {
          return {
            block: true,
            reason: `路径被 MaxmaBlocker 拒止锚保护（${blocked.blockerPath}），已拒绝工具调用（${blocked.toolPath}）`,
          };
        }
        return undefined;
      });
    },
  };
}
