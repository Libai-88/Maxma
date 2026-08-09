/**
 * approval.ts — 工具审批 UI 上下文（ask/read_only 权限模式下等待前端审批）。
 *
 * OMP approval wrapper 调用 `ctx.select(title, ["Approve", "Deny"])`，
 * 并视 `choice === "Approve"` 为批准、其余（含 undefined 超时）为拒绝。
 */
import { randomUUID } from "node:crypto";
import type { ExtensionUIContext, ExtensionUIDialogOptions, ExtensionUISelectItem } from "@oh-my-pi/pi-coding-agent";
import type { MaxmaEvent } from "./rpc-types";
import type { BridgeIo } from "./rpc";
import type { PendingApproval } from "./state";
import { APPROVAL_TIMEOUT_MS, bridgeState } from "./state";

/**
 * Parse the OMP approval title to extract structured tool input and risk level.
 *
 * OMP formats the title as:
 *   "Allow tool: {toolName}\n\nArgs:\n{jsonArgs}\n\nReason: {reason}"
 *
 * Returns extracted tool_input object and a risk_level estimate.
 */
export function parseApprovalTitle(title: string): {
  toolName: string;
  toolInput: Record<string, unknown> | undefined;
  riskLevel: "low" | "medium" | "high";
} {
  const lines = title.split("\n");
  const titleLine = lines[0] ?? "";
  const toolName = titleLine.startsWith("Allow tool: ")
    ? titleLine.slice("Allow tool: ".length)
    : titleLine;

  // Extract Args: block (everything after "Args:" until the next known section or end)
  let toolInput: Record<string, unknown> | undefined;
  const argsIndex = lines.findIndex((l) => l.trim() === "Args:");
  if (argsIndex >= 0) {
    const argsLines: string[] = [];
    for (let i = argsIndex + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed === "" || trimmed.startsWith("Reason:") || trimmed.startsWith("Reasoning:")) break;
      argsLines.push(lines[i]);
    }
    const argsText = argsLines.join("\n").trim();
    if (argsText) {
      try {
        toolInput = JSON.parse(argsText) as Record<string, unknown>;
      } catch {
        toolInput = { raw: argsText };
      }
    }
  }

  // Extract Reason: block for risk level estimation
  const reasonLine = lines.find((l) => l.trim().startsWith("Reason:") || l.trim().startsWith("Reasoning:"));
  const reason = reasonLine?.replace(/^Reason(ing)?:\s*/i, "").toLowerCase() ?? "";

  // Risk level estimation based on reason content
  const highRiskKeywords = ["delete", "remove", "rm", "destroy", "dangerous", "overwrite", "force", "reset"];
  const mediumRiskKeywords = ["write", "edit", "modify", "update", "create", "change", "add", "install", "execute", "run", "bash", "exec"];
  const hasHigh = highRiskKeywords.some((k) => reason.includes(k));
  const hasMedium = mediumRiskKeywords.some((k) => reason.includes(k));
  // Also check tool name for risk signals
  const toolNameLower = toolName.toLowerCase();
  const toolHasHigh = ["delete", "remove", "rm", "destroy"].some((k) => toolNameLower.includes(k));
  const toolHasMedium = ["write", "edit", "modify", "bash", "exec", "run", "create"].some((k) => toolNameLower.includes(k));

  const riskLevel: "low" | "medium" | "high" =
    hasHigh || toolHasHigh ? "high" : hasMedium || toolHasMedium ? "medium" : "low";

  return { toolName, toolInput, riskLevel };
}

export interface ApprovalDeps {
  sendEvent: BridgeIo["sendEvent"];
  pendingApprovals: Map<string, PendingApproval>;
  timeoutMs: number;
  setTimeoutFn: typeof setTimeout;
  clearTimeoutFn: typeof clearTimeout;
  uuidFn: () => string;
}

export function createApprovalUiContext(
  sessionId: string,
  deps: Partial<ApprovalDeps> = {},
): ExtensionUIContext {
  const {
    sendEvent: sendEventFn = defaultSendEvent,
    pendingApprovals: approvals = bridgeState.pendingApprovals,
    timeoutMs = APPROVAL_TIMEOUT_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    uuidFn = randomUUID,
  } = deps;

  const ctx: ExtensionUIContext = {
    select(
      title: string,
      _options: ExtensionUISelectItem[],
      _dialogOptions?: ExtensionUIDialogOptions,
    ): Promise<string | undefined> {
      return new Promise<string | undefined>((resolve, reject) => {
        const interactionId = uuidFn();
        const { toolName, toolInput, riskLevel } = parseApprovalTitle(title);

        const timer = setTimeoutFn(() => {
          if (approvals.has(interactionId)) {
            approvals.delete(interactionId);
            // Timeout → deny (resolve undefined so the wrapper treats as "Deny").
            resolve(undefined);
          }
        }, timeoutMs);

        approvals.set(interactionId, {
          resolve: (choice) => {
            clearTimeoutFn(timer);
            // 双保险清理：RPC user_response 会先 delete，此处兜底 OMP wrapper
            // 直接 resolve 的路径，防止条目泄漏到超时。
            approvals.delete(interactionId);
            resolve(choice);
          },
          reject: (err) => {
            clearTimeoutFn(timer);
            approvals.delete(interactionId);
            reject(err);
          },
          timer,
        });

        const event: MaxmaEvent = {
          type: "ask_user",
          payload: {
            tool_name: toolName,
            question: title,
            mode: "approval",
            options: ["Approve", "Deny"],
            interaction_id: interactionId,
            detail: title,
            risk_level: riskLevel,
            tool_input: toolInput,
          },
        };
        sendEventFn(sessionId, event);
      });
    },
    confirm: (_title: string, _message: string) => Promise.resolve(false),
    input: (_title: string, _placeholder?: string) => Promise.resolve(undefined),
    notify: () => {},
    onTerminalInput: () => () => {},
    setStatus: () => {},
    setWorkingMessage: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    custom: <T,>() => Promise.resolve(undefined as unknown as T),
    setEditorText: () => {},
    pasteToEditor: () => {},
    getEditorText: () => "",
    editor: () => Promise.resolve(undefined),
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    theme: undefined as unknown as ExtensionUIContext["theme"],
    getAllThemes: () => Promise.resolve([]),
    getTheme: () => Promise.resolve(undefined),
    setTheme: () => Promise.resolve({ success: false, error: "not supported" }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  };
  return ctx;
}

/**
 * 默认 sendEvent 实现——写入 stdout（JSON-RPC 通知）。
 * 放在本模块避免 rpc.ts 反向依赖 approval.ts。
 */
function defaultSendEvent(sessionId: string, event: Record<string, unknown>): void {
  process.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "event",
      params: { session_id: sessionId, event },
    }) + "\n",
  );
}
