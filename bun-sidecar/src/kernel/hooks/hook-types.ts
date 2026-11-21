/**
 * kernel/hooks/hook-types.ts — Hooks 配置与事件类型（M3 / A4）。
 *
 * 事件名用 Claude Hooks 的通用拼写（PreToolUse / PostToolUse / SessionStart /
 * SessionEnd / PreCompact），落到 pi 的官方事件名是一一对应的：
 *   PreToolUse → tool_call；PostToolUse → tool_result；SessionStart → session_start；
 *   SessionEnd → session_shutdown；PreCompact → session_before_compact。
 *
 * 这里不承诺"任意脚本随便跑"：配置必须带 HMAC 签名，签名校验失败整份不加载。
 * 处理器只有三种（command/http/prompt），各自能力边界写在本文件与 README 里。
 */

export const HOOK_EVENTS = ["PreToolUse", "PostToolUse", "SessionStart", "SessionEnd", "PreCompact"] as const;
export type HookEventName = typeof HOOK_EVENTS[number];

export const HOOK_HANDLER_TYPES = ["command", "http", "prompt"] as const;
export type HookHandlerType = typeof HOOK_HANDLER_TYPES[number];

export interface HookCommandHandler {
  type: "command";
  /** 可执行文件（不经过 shell，避免注入）。相对路径按会话 cwd 解析。 */
  command: string;
  args?: string[];
  timeoutMs?: number;
}

export interface HookHttpHandler {
  type: "http";
  /** 仅允许 http/https；POST JSON，响应必须是 JSON 或纯文本。 */
  url: string;
  timeoutMs?: number;
}

export interface HookPromptHandler {
  type: "prompt";
  /**
   * 纯文本提示。不调用模型：
   *   - PreToolUse：作为拒绝原因（等价 block）；
   *   - 其它事件：作为附加上下文注入。
   */
  text: string;
}

export type HookHandler = HookCommandHandler | HookHttpHandler | HookPromptHandler;

export interface HookDefinition {
  id: string;
  events: HookEventName[];
  /** 工具事件的正则匹配（对工具名）；缺省匹配全部；会话事件忽略。 */
  matcher?: string;
  handler: HookHandler;
  /** 展示用说明。 */
  description?: string;
}

export interface HooksConfigFile {
  version: 1;
  /** `sha256=<hex>`；由 `bun-sidecar/src/hooks-sign.ts` 生成。 */
  signature?: string;
  hooks: HookDefinition[];
}

export interface HooksLoadResult {
  /** 通过签名与结构校验、可以运行的钩子。 */
  hooks: HookDefinition[];
  /** 配置路径（给错误文案与 UI 用）。 */
  configPath: string;
  /** absent = 没有配置；ready = 已签名且全部合法；invalid = 整份拒绝。 */
  status: "absent" | "ready" | "invalid";
  errors: string[];
  skipped: string[];
}

export interface HookPayload {
  event: HookEventName;
  sessionId: string;
  cwd: string;
  /** 工具事件专用。 */
  toolName?: string;
  toolCallId?: string;
  input?: Record<string, unknown>;
  /** PostToolUse 的工具结果摘要（不传完整大输出）。 */
  result?: { isError: boolean; text: string };
  /** SessionStart 的启动原因等附加信息。 */
  extra?: Record<string, unknown>;
}

export interface HookDecision {
  /** PreToolUse 拒绝。 */
  block?: boolean;
  reason?: string;
  /** PreToolUse 改写工具入参（浅合并，之后仍会过 PathPolicy）。 */
  inputPatch?: Record<string, unknown>;
  /** PostToolUse 追加到工具结果的文本。 */
  contentAppend?: string;
  /** SessionStart 注入的上下文。 */
  additionalContext?: string;
  /** PreCompact 取消压缩。 */
  cancel?: boolean;
  /** PreCompact 追加给摘要器的指令。 */
  customInstructions?: string;
  /** 处理器返回的其它字段（只用于审计，不参与执行）。 */
  raw?: unknown;
}

export interface HookRunRecord {
  hookId: string;
  event: HookEventName;
  status: "ok" | "skipped" | "error";
  durationMs: number;
  decision?: HookDecision;
  error?: string;
}
