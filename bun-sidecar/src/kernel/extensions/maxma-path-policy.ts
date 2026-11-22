/**
 * kernel/extensions/maxma-path-policy.ts — 工具执行前的路径策略钩子（M1 / T2）。
 *
 * 与 MaxmaBlocker 一样使用官方 `tool_call` 钩子：在执行前 block，工具不会开跑，
 * 因而没有“先写了一半再被拦”的部分副作用。审批门在其后运行，所以越界路径
 * 不会先弹一张审批卡再被拒绝。
 */

import type { ExtensionAPI, InlineExtension, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";
import { extractPaths } from "../../blocker";
import type { PathIntent, PathPolicy } from "../path-policy";
import { evaluateCommandPolicy, shellEnvPrefix } from "../command-policy";
import { recordToolDenied } from "../agent-audit";

export const MAXMA_PATH_POLICY_EXTENSION_NAME = "maxma-path-policy";

const READ_TOOLS = new Set(["read", "grep", "find", "ls", "read_office_file", "read_file", "code_diagnostics"]);
const WRITE_TOOLS = new Set(["write", "edit", "write_office_file", "edit_office_file", "write_file", "mkdir", "code_apply_patch"]);

function intentFor(toolName: string): PathIntent | null {
  const name = toolName.toLowerCase();
  if (READ_TOOLS.has(name)) return "read";
  if (WRITE_TOOLS.has(name)) return "write";
  return null;
}

export function createMaxmaPathPolicyExtension(
  policy: PathPolicy,
  shellRoot: string,
  sessionId = "unknown",
): InlineExtension {
  return {
    name: MAXMA_PATH_POLICY_EXTENSION_NAME,
    factory: (pi: ExtensionAPI) => {
      pi.on("tool_call", async (event: ToolCallEvent): Promise<ToolCallEventResult | undefined> => {
        const input = (event as { input?: Record<string, unknown> }).input ?? {};
        const name = event.toolName;
        const deny = (reason: string): ToolCallEventResult => {
          recordToolDenied({
            sessionId,
            toolName: name,
            toolCallId: typeof event.toolCallId === "string" ? event.toolCallId : undefined,
            args: input,
            reason,
          });
          return { block: true, reason };
        };

        if (name === "bash" || name === "powershell") {
          const command = typeof input.command === "string" ? input.command : "";
          if (!command.trim()) {
            return deny("命令为空，路径策略拒绝执行");
          }
          const guard = evaluateCommandPolicy(policy, command, { toolName: name });
          if (!guard.allowed) {
            return deny(
              `命令被安全策略拒绝（${guard.code ?? "COMMAND_INVALID"}）：${guard.reason ?? "命令未通过策略"}；不要重试同一命令，请改用工作区内路径或专用工具`,
            );
          }
          const cwd = typeof input.cwd === "string" ? input.cwd : "";
          if (cwd) {
            const cwdDecision = policy.check(cwd, "execute");
            if (!cwdDecision.allowed) {
              return deny(`命令工作目录不在授权工作区：${cwdDecision.reason ?? "路径策略拒绝"}`);
            }
          }
          // 不改写命令语义，只在前面重建 HOME/TMP 并清掉常见凭据变量。
          // 真正防越权读取仍需 OS 沙箱；这里明确标记为 policy-only。
          input.command = `${shellEnvPrefix(name === "powershell" ? "powershell" : "bash", shellRoot)}${command}`;
          return undefined;
        }

        if (name === "code_apply_patch") {
          const edits = Array.isArray(input.edits) ? input.edits : [];
          if (edits.length === 0 || edits.length > 20) {
            return deny("多文件编辑必须包含 1–20 项 edits");
          }
          for (const edit of edits) {
            const rawPath = edit && typeof edit === "object" ? (edit as { path?: unknown }).path : null;
            if (typeof rawPath !== "string" || !rawPath.trim()) {
              return deny("多文件编辑的每个 edit 都必须有非空 path");
            }
            const absolute = path.resolve(shellRoot, rawPath);
            const decision = policy.check(absolute, "write");
            if (!decision.allowed) {
              return deny(
                `多文件编辑路径被拒绝（${decision.code ?? "PATH_OUTSIDE_ROOT"}）：${decision.reason ?? "路径不在授权工作区内"}；不要重试同一路径`,
              );
            }
          }
          return undefined;
        }

        const intent = intentFor(name);
        if (!intent) {
          // 没有路径参数的未知工具不在这里拦截；权限门与 blocker 仍有各自的边界。
          return undefined;
        }
        for (const rawPath of extractPaths(input)) {
          const decision = policy.check(rawPath, intent);
          if (!decision.allowed) {
            return deny(
              `${name} 的路径被拒绝（${decision.code ?? "PATH_OUTSIDE_ROOT"}）：${decision.reason ?? "路径不在授权工作区内"}；不要重试同一路径`,
            );
          }
        }
        return undefined;
      });
    },
  };
}
