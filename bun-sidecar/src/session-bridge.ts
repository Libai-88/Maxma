/**
 * session-bridge.ts — JSON-RPC server wrapping createAgentSession.
 *
 * RPC Methods:
 *   create_session({ model, system_prompt?, cwd? }) → { session_id }
 *   prompt({ session_id, message })               → { ok: true }
 *   cancel({ session_id })                         → { ok: true }
 *   destroy_session({ session_id })                → { ok: true }
 *   undo({ session_id, steps? })                   → { removed }
 *   get_messages({ session_id, limit? })           → { messages, total }
 *   get_settings({ paths? })                       → { settings }
 *   set_settings({ path, value })                  → { ok: true }
 *
 * Events are forwarded as JSON-RPC notifications (method: "event").
 */

import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { createAgentSession, discoverAuthStorage, Settings } from "@oh-my-pi/pi-coding-agent";
import { MCPManager } from "@oh-my-pi/pi-coding-agent/mcp";
import type { MCPServerConfig } from "@oh-my-pi/pi-coding-agent/mcp";
import type {
  AgentSession,
  ExtensionUIContext,
  ExtensionUIDialogOptions,
  ExtensionUISelectItem,
} from "@oh-my-pi/pi-coding-agent";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import type { Model } from "@oh-my-pi/pi-ai";
import { registerCustomTools } from "./tools/index";
import type { MaxmaEvent } from "./rpc-types";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionRecord {
  session: AgentSession;
  unsubscribe: () => void;
  promptQueue: Promise<void>;  // serializes concurrent prompt calls
  currentGuard: DoneGuard | null;  // active per-prompt done sentinel
  mcpManager?: MCPManager;
  mcpConfigs?: Record<string, MCPServerConfig>;
  mcpAllowBlock?: Record<string, { allow?: string[]; block?: string[] }>;
  mcpToolNames?: string[];
  settings?: Settings;
}

type MaxmaMcpEntry = Record<string, unknown> & { server_id?: string; transport?: string };

function mcpConfigPath(): string {
  return path.resolve(process.env.MAXMA_PROJECT_ROOT ?? process.cwd(), "api/data/mcp_servers.yaml");
}

/** Convert Maxma's persisted list into OMP's actual MCPManager input. */
export function loadConfiguredMcp(): {
  configs: Record<string, MCPServerConfig>;
  allowBlock: Record<string, { allow?: string[]; block?: string[] }>;
  unsupported: Record<string, string>;
} | undefined {
  const configPath = mcpConfigPath();
  if (!fs.existsSync(configPath)) return undefined;
  const bunRuntime = globalThis as typeof globalThis & { Bun: { YAML: { parse(text: string): unknown } } };
  let parsed: Record<string, unknown>;
  try {
    const value = bunRuntime.Bun.YAML.parse(fs.readFileSync(configPath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      console.error("[mcp] configuration root must be an object; ignoring configuration");
      return undefined;
    }
    parsed = value as Record<string, unknown>;
  } catch {
    // Parser messages can echo inline secrets, so log only a stable diagnostic.
    console.error("[mcp] invalid YAML configuration; ignoring configuration");
    return undefined;
  }
  const entries = Array.isArray(parsed.mcp_servers) ? parsed.mcp_servers : [];
  const configs: Record<string, MCPServerConfig> = {};
  const allowBlock: Record<string, { allow?: string[]; block?: string[] }> = {};
  const unsupported: Record<string, string> = {};
  for (const [index, rawEntry] of entries.entries()) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      console.error(`[mcp] ignoring invalid configuration entry at index ${index}`);
      continue;
    }
    const entry = rawEntry as MaxmaMcpEntry;
    const name = typeof entry.server_id === "string" ? entry.server_id : undefined;
    const transport = entry.transport;
    if (!name || entry.enabled === false || typeof transport !== "string") continue;
    const config: Record<string, unknown> = { enabled: true };
    if (transport === "stdio") {
      config.type = "stdio";
      for (const key of ["command", "args", "env", "cwd", "timeout"]) if (key in entry) config[key] = entry[key];
    } else if (transport === "sse" || transport === "streamable_http") {
      config.type = transport === "streamable_http" ? "http" : transport;
      for (const key of ["url", "headers", "timeout"]) if (key in entry) config[key] = entry[key];
    } else if (transport === "websocket") {
      // Keep the configured server visible in diagnostics, but never hand an
      // OMP-incompatible type to MCPManager.connectServers.
      unsupported[name] = "OMP SDK does not support websocket MCP transport";
      continue;
    } else {
      unsupported[name] = `Unsupported MCP transport: ${transport}`;
      continue;
    }
    const allowedTools = entry.allowed_tools ?? entry.allow;
    const blockedTools = entry.blocked_tools ?? entry.block;
    if (allowedTools !== undefined || blockedTools !== undefined) {
      allowBlock[name] = {
        allow: Array.isArray(allowedTools) ? allowedTools as string[] : undefined,
        block: Array.isArray(blockedTools) ? blockedTools as string[] : undefined,
      };
      // OMP has no allow/block config fields; retain them locally for tool filtering.
    }
    if ("tls_verify" in entry) unsupported[name] ??= "OMP SDK does not expose tls_verify for MCP transports";
    if ("sse_read_timeout" in entry) unsupported[name] ??= "OMP SDK does not expose sse_read_timeout";
    configs[name] = config as unknown as MCPServerConfig;
  }
  if (Object.keys(configs).length === 0 && Object.keys(unsupported).length === 0) return undefined;
  return { configs, allowBlock, unsupported };
}

export function filterMcpTools(
  tools: any[],
  allowBlock: Record<string, { allow?: string[]; block?: string[] }>,
  requestedToolNames?: string[],
): any[] {
  const requested = requestedToolNames === undefined ? undefined : new Set(requestedToolNames);
  return tools.filter((tool) => {
    const server = tool.mcpServerName as string | undefined;
    if (server && requested && !requested.has(String(tool.name)) && !requested.has(String(tool.mcpToolName ?? ""))) {
      return false;
    }
    const rules = server ? allowBlock[server] : undefined;
    if (!rules) return true;
    const toolName = String(tool.mcpToolName ?? tool.name ?? "");
    if (rules.allow && rules.allow.length > 0 && !rules.allow.includes(toolName)) return false;
    return !rules.block?.includes(toolName);
  });
}

export async function createConfiguredMcp(cwd: string, authStorage: any): Promise<{
  manager: MCPManager;
  configs: Record<string, MCPServerConfig>;
  tools: any[];
  allowBlock: Record<string, { allow?: string[]; block?: string[] }>;
} | undefined> {
  const loaded = loadConfiguredMcp();
  if (!loaded) return undefined;
  for (const [name, message] of Object.entries(loaded.unsupported)) {
    console.error(`[mcp] ${name}: ${message}`);
  }
  // An unsupported-only file must retain the old session creation path.
  if (Object.keys(loaded.configs).length === 0) return undefined;
  const manager = new MCPManager(cwd);
  manager.setAuthStorage(authStorage);
  const sourcePath = mcpConfigPath();
  const sources = Object.fromEntries(Object.keys(loaded.configs).map((name) => [name, {
    provider: "maxma",
    providerName: "Maxma MCP configuration",
    path: sourcePath,
    level: "project" as const,
  }]));
  const result = await manager.connectServers(loaded.configs, sources);
  for (const [name, message] of result.errors) console.error(`[mcp] ${name}: ${message}`);
  return { manager, configs: loaded.configs, allowBlock: loaded.allowBlock, tools: filterMcpTools(result.tools, loaded.allowBlock) };
}

export async function buildCreateSessionOptions(
  input: {
    model: Model;
    cwd: string;
    authStorage: any;
    systemPrompt?: string;
    tools?: string[];
    permissionMode?: string;
  },
  createMcp: typeof createConfiguredMcp = createConfiguredMcp,
): Promise<{
  options: Record<string, unknown>;
  needsApproval: boolean;
  mcpManager?: MCPManager;
  mcpConfigs?: Record<string, MCPServerConfig>;
  mcpAllowBlock?: Record<string, { allow?: string[]; block?: string[] }>;
  mcpToolNames?: string[];
}> {
  const createOptions: Record<string, unknown> = {
    model: input.model,
    cwd: input.cwd,
    authStorage: input.authStorage,
  };
  if (input.systemPrompt !== undefined) createOptions.systemPrompt = input.systemPrompt;
  if (input.tools !== undefined && input.tools.length > 0) createOptions.toolNames = input.tools;

  const needsApproval = input.permissionMode === "ask" || input.permissionMode === "read_only";
  createOptions.autoApprove = !needsApproval;
  if (needsApproval) {
    createOptions.hasUI = true;
    // Inherit global settings and only override approval mode, instead of
    // creating an empty isolated copy that loses all user preferences.
    const globalPaths = [
      "compaction.enabled", "compaction.strategy", "compaction.thresholdPercent",
      "retry.enabled", "retry.maxRetries", "retry.modelFallback",
      "tools.discoveryMode", "advisor.enabled",
      "steeringMode", "interruptMode", "followUpMode",
      "thinkingBudgets.minimal", "thinkingBudgets.low", "thinkingBudgets.medium",
      "thinkingBudgets.high", "thinkingBudgets.xhigh", "thinkingBudgets.max",
      "skills.enabled", "bash.enabled", "lsp.enabled", "git.enabled",
      "edit.mode", "read.summarize.enabled",
      "todo.enabled", "glob.enabled", "grep.enabled", "browser.enabled",
      "github.enabled", "checkpoint.enabled", "inspect_image.enabled",
    ];
    const globalOverrides: Record<string, unknown> = {};
    try {
      const global = await ensureSettings();
      for (const p of globalPaths) {
        try { const v = global.get(p as any); if (v !== undefined) globalOverrides[p] = v; } catch { /* skip */ }
      }
    } catch { /* global not available */ }
    createOptions.settings = Settings.isolated({
      ...globalOverrides,
      "tools.approvalMode": "always-ask",
    });
  }

  const customTools = registerCustomTools();
  if (customTools.length > 0) createOptions.customTools = customTools;

  const configuredMcp = await createMcp(input.cwd, input.authStorage);
  if (configuredMcp) {
    createOptions.mcpManager = configuredMcp.manager;
    const existingTools = Array.isArray(createOptions.customTools) ? createOptions.customTools as any[] : [];
    createOptions.customTools = [
      ...existingTools,
      ...filterMcpTools(configuredMcp.tools, configuredMcp.allowBlock, input.tools),
    ];
  }

  return {
    options: createOptions,
    needsApproval,
    mcpManager: configuredMcp?.manager,
    mcpConfigs: configuredMcp?.configs,
    mcpAllowBlock: configuredMcp?.allowBlock,
    mcpToolNames: input.tools,
  };
}

/** OMP skips this callback when the manager is supplied by the caller. */
export function wireMcpToolsChanged(
  session: AgentSession,
  manager: MCPManager,
  allowBlock: Record<string, { allow?: string[]; block?: string[] }>,
  requestedToolNames?: string[],
): void {
  manager.setOnToolsChanged((tools) => {
    void session.refreshMCPTools(filterMcpTools(tools, allowBlock, requestedToolNames)).catch((error) => {
      console.error(`[mcp] failed to refresh session tools: ${error instanceof Error ? error.message : "unknown error"}`);
    });
  });
}

export function mcpReloadUnsupportedResponse(): {
  status: "unsupported";
  code: "mcp_reload_requires_session_rebuild";
  message: string;
} {
  return {
    status: "unsupported",
    code: "mcp_reload_requires_session_rebuild",
    message: "MCP configuration reload is not exposed through the Maxma API; rebuild the session",
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const sessions = new Map<string, SessionRecord>();
const rl = createInterface({ input: process.stdin });
let authStoragePromise: ReturnType<typeof discoverAuthStorage> | null = null;
let settingsInitPromise: Promise<Settings> | null = null;

/** Ensure the global Settings singleton is initialized before use. */
async function ensureSettings(): Promise<Settings> {
  if (!settingsInitPromise) {
    settingsInitPromise = Settings.init().then(() => Settings.instance);
  }
  return settingsInitPromise;
}

// ── Tool approval state ───────────────────────────────────
// Pending approval promises keyed by interaction_id. Resolved by the
// user_response RPC handler when the frontend replies.
interface PendingApproval {
  resolve: (choice: string | undefined) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
const pendingApprovals = new Map<string, PendingApproval>();

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 min → auto-deny

/** Track tool elapsed: toolCallId → start timestamp (ms) */
const _toolStartTimestamps = new Map<string, number>();

async function getSharedAuthStorage() {
  if (!authStoragePromise) authStoragePromise = discoverAuthStorage();
  return authStoragePromise;
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

function send(id: number | null, result: unknown) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function sendError(id: number | null, message: string) {
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id, error: { message } }) + "\n",
  );
}

function sendEvent(sessionId: string, event: Record<string, unknown>) {
  process.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "event",
      params: { session_id: sessionId, event },
    }) + "\n",
  );
}

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

/**
 * Parse a model string like "openai/gpt-4o" into a proper Model object.
 *
 * Strategy:
 *   A — Try `getBundledModel(provider, modelId)` from the bundled catalog.
 *   B — Fall back to constructing a minimal Model object manually.
 */
function parseModel(
  modelStr: string,
  options?: { provider?: string; baseUrl?: string; providerType?: string },
): Model {
  const slashIdx = modelStr.indexOf("/");
  const parsedProvider = slashIdx >= 0 ? modelStr.slice(0, slashIdx) : "";
  const parsedModelId = slashIdx >= 0 ? modelStr.slice(slashIdx + 1) : modelStr;
  const provider = options?.provider ?? parsedProvider;
  const modelId = options?.provider ? modelStr : parsedModelId;

  // Option A: bundled catalog lookup
  if (provider) {
    try {
      const bundled = getBundledModel(provider as any, modelId);
      if (bundled) return bundled;
    } catch {
      // Fall through to manual construction
    }
  }

  // Option B: manual fallback (minimal Model object from env vars)
  const baseUrl = options?.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions" as const,
    provider,
    baseUrl,
    reasoning: false,
    input: ["text"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
    compat: {
      supportsDeveloperRole: true,
      supportsStrictMode: false,
      supportsReasoningEffort: false,
      reasoningEffortMap: {},
      supportsReasoningParams: false,
      thinkingFormat: "openai" as const,
      reasoningDisableMode: "omit" as const,
      omitReasoningEffort: false,
      includeEncryptedReasoning: false,
      filterReasoningHistory: false,
      disableReasoningOnForcedToolChoice: false,
      disableReasoningOnToolChoice: false,
      supportsToolChoice: true,
      supportsForcedToolChoice: true,
      supportsNamedToolChoice: true,
      reasoningContentField: undefined,
      requiresReasoningContentForToolCalls: false,
      requiresReasoningContentForAllAssistantTurns: false,
      allowsSyntheticReasoningContentForToolCalls: false,
      replayReasoningContent: false,
      qwenPreserveThinking: false,
      requiresThinkingAsText: false,
      requiresMistralToolIds: false,
      requiresToolResultName: false,
      requiresAssistantAfterToolResult: false,
      requiresAssistantContentForToolCalls: false,
      stripDeepseekSpecialTokens: false,
      streamMarkupHealingPattern: undefined,
      reasoningDeltasMayBeCumulative: false,
      emptyLengthFinishIsContextError: false,
      usesOpenAIToolCallIdLimit: false,
      promptCacheSessionHeader: undefined,
      isOpenRouterHost: false,
      alwaysSendMaxTokens: true,
      enableGeminiThinkingLoopGuard: undefined,
      openRouterRouting: undefined,
      wireModelIdMode: "raw" as const,
      supportsStore: false,
      supportsMultipleSystemMessages: true,
      maxTokensField: "max_tokens" as const,
      supportsUsageInStreaming: true,
      cacheControlFormat: undefined,
      supportsLongPromptCacheRetention: false,
      supportsImageDetailOriginal: false,
      strictResponsesPairing: false,
      toolStrictMode: "none" as const,
      streamIdleTimeoutMs: undefined,
      vercelGatewayRouting: undefined,
      extraBody: undefined,
    },
  } as Model;
}

// ---------------------------------------------------------------------------
// Pi event → Maxma event mapping
// ---------------------------------------------------------------------------

/** Shape of OMP AgentEvent fields consumed by mapPiEventToMaxma. */
interface OmpToolEvent {
  type: string;
  toolName?: string;
  toolCallId?: string;
  args?: Record<string, unknown>;
  partialResult?: unknown;
  result?: unknown;
  isError?: boolean;
  message?: { content?: string | Array<{ type: string; text?: string }> };
  intent?: string;
}

interface OmpAssistantMessageEvent {
  type: string;
  delta?: string;
  content?: string;
  error?: unknown;
}

export function mapPiEventToMaxma(
  piEvent: Record<string, unknown>,
  guard?: { done: boolean } | null,
): Record<string, unknown> | null {
  const type = piEvent.type as string;

  if (type === "message_update") {
    const assistantEvent = piEvent.assistantMessageEvent as OmpAssistantMessageEvent | undefined;
    if (!assistantEvent) return null;

    const aeType = assistantEvent.type;

    if (aeType === "text_delta") {
      return {
        type: "token",
        payload: { token: assistantEvent.delta ?? "" },
      };
    }

    // thinking_start / thinking_delta / thinking_end — map reasoning
    // content so the frontend can render ThinkingBlocks.
    // Follow the same text_delta → token pattern for the delta text.

    if (aeType === "thinking_start") {
      return {
        type: "thinking_start",
        payload: {},
      };
    }

    if (aeType === "thinking_delta") {
      return {
        type: "thinking_delta",
        payload: { delta: assistantEvent.delta ?? "" },
      };
    }

    if (aeType === "thinking_end") {
      return {
        type: "thinking_end",
        payload: { content: assistantEvent.content ?? "" },
      };
    }

    // NOTE: toolcall_start/toolcall_end from message_update are pre-execution
    // events (LLM deciding to call a tool). The actual execution data comes
    // from tool_execution_start/tool_execution_end below, which carry full
    // toolName and result data. Skip early message_update tool events to avoid
    // duplicate/empty-named events.

    if (aeType === "error") {
      const errObj = assistantEvent.error as { content?: Array<{ text?: string }> } | undefined;
      const errMsg =
        errObj?.content?.[0]?.text ??
        "Unknown agent error";
      return {
        type: "error",
        payload: { code: "AGENT_ERROR", message: errMsg },
      };
    }

    return null;
  }

  if (type === "tool_execution_start") {
    const e = piEvent as unknown as OmpToolEvent;
    if (e.toolCallId) _toolStartTimestamps.set(e.toolCallId, Date.now());
    return {
      type: "tool_start",
      payload: {
        tool_name: e.toolName ?? "",
        input: JSON.stringify(e.args ?? {}),
      },
    };
  }

  if (type === "tool_execution_update") {
    const e = piEvent as unknown as OmpToolEvent;
    return {
      type: "tool_update",
      payload: {
        tool_name: e.toolName ?? "",
        partial_result: typeof e.partialResult === "string"
          ? e.partialResult
          : JSON.stringify(e.partialResult ?? ""),
      },
    };
  }

  if (type === "tool_execution_end") {
    const e = piEvent as unknown as OmpToolEvent;
    const startMs = e.toolCallId ? _toolStartTimestamps.get(e.toolCallId) : undefined;
    if (e.toolCallId) _toolStartTimestamps.delete(e.toolCallId);
    const elapsed = startMs !== undefined ? Math.round((Date.now() - startMs) / 1000) : 0;
    const isError = e.isError === true;
    if (isError) {
      return {
        type: "tool_error",
        payload: {
          tool_name: e.toolName ?? "",
          error: JSON.stringify(e.result ?? {}),
          elapsed,
        },
      };
    }
    return {
      type: "tool_end",
      payload: {
        tool_name: e.toolName ?? "",
        output: JSON.stringify(e.result ?? {}),
        elapsed,
      },
    };
  }

  if (type === "message_end") {
    const msg = (piEvent as unknown as OmpToolEvent).message;
    let content = "";
    if (msg?.content) {
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .filter((b): b is { type: string; text: string } => b?.type === "text")
          .map(b => b.text)
          .join("");
      }
    }
    return {
      type: "answer",
      payload: { content },
    };
  }

  if (type === "auto_compaction_end") {
    const e = piEvent as unknown as OmpAutoCompactionEndEvent;
    const result = e.result;
    const summaryPreview =
      result?.shortSummary ?? result?.summary ?? "";
    return {
      type: "context_compressed",
      payload: {
        summary_preview: summaryPreview.slice(0, 200),
        before_tokens: result?.tokensBefore,
        action: e.action ?? "context-full",
        skipped: e.skipped ?? false,
        aborted: e.aborted ?? false,
        will_retry: e.willRetry ?? false,
        error_message: e.errorMessage,
      },
    };
  }

  if (type === "auto_compaction_start") {
    const e = piEvent as unknown as OmpAutoCompactionStartEvent;
    const reason = e.reason ?? "threshold";
    const action = e.action ?? "context-full";
    return {
      type: "context_compressing",
      payload: {
        reason: ["threshold", "overflow", "idle", "incomplete"].includes(reason)
          ? (reason as "threshold" | "overflow" | "idle" | "incomplete")
          : "threshold",
        action: ["context-full", "handoff", "shake", "snapcompact"].includes(action)
          ? (action as "context-full" | "handoff" | "shake" | "snapcompact")
          : "context-full",
      },
    };
  }

  if (type === "agent_end") {
    if (guard) guard.done = true;
    return { type: "done", payload: {} };
  }

  // OMP auto-retry events
  if (type === "auto_retry_start") {
    const e = piEvent as unknown as OmpAutoRetryEvent;
    return {
      type: "retry_start",
      payload: {
        attempt: e.attempt ?? 0,
        max_attempts: e.maxAttempts ?? 0,
        delay_ms: e.delayMs ?? 0,
        error_message: e.errorMessage ?? "",
      },
    };
  }

  if (type === "auto_retry_end") {
    const e = piEvent as unknown as OmpAutoRetryEvent;
    return {
      type: "retry_end",
      payload: {
        success: e.success ?? false,
        attempt: e.attempt ?? 0,
        final_error: e.finalError,
      },
    };
  }

  // OMP todo reminder
  if (type === "todo_reminder") {
    const e = piEvent as unknown as OmpTodoReminderEvent;
    return {
      type: "todo_reminder",
      payload: {
        todos: (e.todos ?? []).map(t => ({
          content: t?.content ?? "",
          status: t?.status ?? "pending",
        })),
        attempt: e.attempt ?? 0,
        max_attempts: e.maxAttempts ?? 0,
      },
    };
  }

  // OMP IRC multi-agent message
  if (type === "irc_message") {
    const e = piEvent as unknown as OmpIrcMessageEvent;
    const msg = e.message;
    if (!msg) return null;
    return {
      type: "irc_message",
      payload: {
        from: msg.from ?? "",
        to: msg.to ?? "",
        body: msg.body ?? "",
        id: msg.id ?? "",
      },
    };
  }

  // OMP notice
  if (type === "notice") {
    const e = piEvent as unknown as OmpNoticeEvent;
    return {
      type: "notice",
      payload: {
        level: e.level ?? "info",
        message: e.message ?? "",
        source: e.source,
      },
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Per-prompt done guard + orchestration
// ---------------------------------------------------------------------------

export interface DoneGuard {
  done: boolean;
}

export function createDoneGuard(): DoneGuard {
  return { done: false };
}

/**
 * Run session.prompt(message) with a guaranteed done-event emission.
 *
 * Semantics:
 *   - If the subscriber fires `agent_end` during the call, it marks `guard.done`
 *     and emits `done` itself; the finally block then becomes a no-op.
 *   - If prompt() throws, emit a `PROMPT_ERROR` event (unless done was already
 *     emitted), then emit `done` via the finally block.
 *   - If the prompt exceeds `timeoutMs`, emit `PROMPT_TIMEOUT` error + `done`
 *     and abort the agent.
 *
 * The `sink` callback is invoked for every emitted event and is responsible
 * for the session_id envelope (callers bind it).
 */
export async function orchestratePrompt(
  session: AgentSession,
  message: string,
  guard: DoneGuard,
  sink: (event: Record<string, unknown>) => void,
  timeoutMs: number = 600_000,
): Promise<void> {
  const timeoutId = setTimeout(() => {
    if (guard.done) return;
    guard.done = true;
    sink({
      type: "error",
      payload: { code: "PROMPT_TIMEOUT", message: `Prompt exceeded ${timeoutMs}ms limit` },
    });
    sink({ type: "done", payload: {} });
    try {
      session.agent.abort("Prompt timeout");
    } catch {
      // best-effort abort
    }
  }, timeoutMs);

  try {
    await session.prompt(message);
  } catch (err) {
    if (!guard.done) {
      sink({
        type: "error",
        payload: { code: "PROMPT_ERROR", message: String(err) },
      });
    }
  } finally {
    clearTimeout(timeoutId);
    if (!guard.done) {
      guard.done = true;
      sink({ type: "done", payload: {} });
    }
  }
}

/**
 * Resolve the cancel RPC against the currently-active prompt guard.
 *
 *   - guard active & not done   → mark done, emit `done` (prompt's finally becomes a no-op)
 *   - guard active & already done → no-op (agent_end / timeout already emitted done)
 *   - no guard (idle)           → emit `done` once for legacy compatibility
 *
 * The active prompt's try/finally would also emit `done` via the guard, but we
 * mark + emit here so cancel is resolved promptly even if the abort does not
 * propagate synchronously.
 */
export function handleCancelGuard(
  guard: DoneGuard | null,
  sink: (event: Record<string, unknown>) => void,
): void {
  if (guard && guard.done) return;
  if (guard) guard.done = true;
  sink({ type: "done", payload: {} });
}

// ---------------------------------------------------------------------------
// Main event subscriber
// ---------------------------------------------------------------------------

function subscribeSession(
  sessionId: string,
  session: AgentSession,
  record: SessionRecord,
): () => void {
  return session.subscribe((event: any) => {
    const mapped = mapPiEventToMaxma(event as Record<string, unknown>, record.currentGuard);
    if (mapped) {
      sendEvent(sessionId, mapped);
    }
  });
}

// ---------------------------------------------------------------------------
// Tool approval UI context
// ---------------------------------------------------------------------------

/**
 * Build a minimal ExtensionUIContext for `setToolUIContext`. Only `select` is
 * real — it emits an `ask_user` event and awaits the matching `user_response`
 * RPC. All other methods are no-ops because the sidecar has no TUI.
 *
 * The oh-my-pi approval wrapper calls
 *   `ctx.select(formatApprovalPrompt(tool, args, reason), ["Approve", "Deny"])`
 * and treats `choice === "Approve"` as approved; anything else (including
 * `undefined` from timeout/throw) is treated as denied.
 */
function createApprovalUiContext(sessionId: string): ExtensionUIContext {
  const ctx: ExtensionUIContext = {
    select(
      title: string,
      _options: ExtensionUISelectItem[],
      _dialogOptions?: ExtensionUIDialogOptions,
    ): Promise<string | undefined> {
      return new Promise<string | undefined>((resolve, reject) => {
        const interactionId = randomUUID();
        // The approval wrapper calls select() BEFORE tool_execution_start fires.
        // Parse the tool name from the formatted title ("Allow tool: <name>\n…").
        // Prefix check is more robust than regex — OMP controls the prefix.
        const titleLine = title.split("\n")[0] ?? "";
        const toolName = titleLine.startsWith("Allow tool: ")
          ? titleLine.slice("Allow tool: ".length)
          : titleLine;

        const timer = setTimeout(() => {
          if (pendingApprovals.has(interactionId)) {
            pendingApprovals.delete(interactionId);
            // Timeout → deny (resolve undefined so the wrapper treats as "Deny").
            resolve(undefined);
          }
        }, APPROVAL_TIMEOUT_MS);

        pendingApprovals.set(interactionId, {
          resolve: (choice) => {
            clearTimeout(timer);
            resolve(choice);
          },
          reject: (err) => {
            clearTimeout(timer);
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
          },
        };
        sendEvent(sessionId, event);
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
    theme: {} as any,
    getAllThemes: () => Promise.resolve([]),
    getTheme: () => Promise.resolve(undefined),
    setTheme: () => Promise.resolve({ success: false, error: "not supported" }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  };
  return ctx;
}

// ---------------------------------------------------------------------------
// RPC handler
// ---------------------------------------------------------------------------

async function shutdown() {
  for (const [_sid, record] of sessions) {
    try {
      record.unsubscribe();
      await record.session.dispose();
    } catch {
      // best-effort cleanup
    } finally {
      await record.mcpManager?.disconnectAll().catch(() => {});
    }
  }
  sessions.clear();
  rl.close();
  process.exit(0);
}

if (import.meta.main) {
  rl.on("line", async (line: string) => {
    let req: any;
    try {
      req = JSON.parse(line);
    } catch {
      sendError(null, "Parse error");
      return;
    }

    const { method, params, id } = req;

    try {
      if (method === "create_session") {
        const modelStr: string = params?.model ?? "openai/gpt-4o";
        const provider: string | undefined = params?.provider || undefined;
        const apiKey: string | undefined = params?.api_key || undefined;
        const authStorage = await getSharedAuthStorage();
        if (provider && apiKey) authStorage.setRuntimeApiKey(provider, apiKey);
        const model = parseModel(modelStr, {
          provider,
          baseUrl: params?.base_url,
          providerType: params?.provider_type,
        });
        const cwd: string = params?.cwd ?? process.cwd();
        const systemPrompt: string | undefined = params?.system_prompt;
        const tools: string[] | undefined = params?.tools as string[] | undefined;
        const permissionMode: string = (params?.permission_mode as string) ?? "ask";

        const { options: createOptions, needsApproval, mcpManager, mcpConfigs, mcpAllowBlock, mcpToolNames } = await buildCreateSessionOptions({
          model,
          cwd,
          authStorage,
          systemPrompt,
          tools: Array.isArray(tools) ? tools : undefined,
          permissionMode,
        });

        const sessionId = randomUUID();
        let session: AgentSession;
        let setToolUIContext: (uiContext: ExtensionUIContext, hasUI: boolean) => void;
        try {
          ({ session, setToolUIContext } = await createAgentSession(createOptions as any));
        } catch (error) {
          await mcpManager?.disconnectAll().catch(() => {});
          throw error;
        }
        if (mcpManager) wireMcpToolsChanged(session, mcpManager, mcpAllowBlock ?? {}, mcpToolNames);
        if (needsApproval) {
          const approvalCtx = createApprovalUiContext(sessionId);
          // setToolUIContext only writes to ToolContextStore (for tool-level
          // hasUI checks). The approval wrapper checks runner.hasUI() which
          // reads from ExtensionRunner.#uiContext — set via initialize().
          // We call initialize() with stub actions (sidecar has no TUI/commands)
          // purely to install our UI context so hasUI() returns true.
          const runner = session.extensionRunner;
          if (runner) {
            runner.initialize(
              {
                sendMessage: () => {},
                sendUserMessage: () => {},
                appendEntry: () => {},
                setLabel: () => {},
                getActiveTools: () => [],
                getAllTools: () => [],
                setActiveTools: () => {},
                getCommands: () => [],
                setModel: () => {},
                getThinkingLevel: () => undefined,
                setThinkingLevel: () => {},
                getSessionName: () => undefined,
                setSessionName: async () => {},
              } as any,
              {
                getModel: () => undefined,
                isIdle: () => true,
                abort: () => {},
                hasPendingMessages: () => false,
                shutdown: () => {},
                getContextUsage: () => undefined,
                compact: async () => {},
                getSystemPrompt: () => [],
              } as any,
              undefined,
              approvalCtx,
            );
          }
          if (setToolUIContext) {
            setToolUIContext(approvalCtx, true);
          }
        }

        const record: SessionRecord = {
          session,
          unsubscribe: () => {},
          promptQueue: Promise.resolve(),
          currentGuard: null,
          mcpManager,
          mcpConfigs,
          mcpAllowBlock,
          mcpToolNames,
          settings: session.settings,
        };
        record.unsubscribe = subscribeSession(sessionId, session, record);
        sessions.set(sessionId, record);

        send(id, { session_id: sessionId });
        return;
      }

      if (method === "prompt") {
        const sessionId: string = params?.session_id;
        const message: string = params?.message ?? "";
        const record = sessions.get(sessionId);
        if (!record) {
          sendError(id, `Session not found: ${sessionId}`);
          return;
        }

        // Serialize: chain onto the previous prompt so they run sequentially.
        // A failed prompt does not block the next one (.catch resets the chain).
        // orchestratePrompt guarantees the `done` event is emitted exactly once
        // on every path (natural agent_end, error, abort, or 600s timeout).
        record.promptQueue = record.promptQueue
          .catch(() => {})
          .then(async () => {
            const guard = createDoneGuard();
            record.currentGuard = guard;
            try {
              await orchestratePrompt(
                record.session,
                message,
                guard,
                (e) => sendEvent(sessionId, e),
              );
            } finally {
              if (record.currentGuard === guard) {
                record.currentGuard = null;
              }
            }
          });

        send(id, { ok: true });
        return;
      }

      if (method === "cancel") {
        const sessionId: string = params?.session_id;
        const record = sessions.get(sessionId);
        if (!record) {
          sendError(id, `Session not found: ${sessionId}`);
          return;
        }

        record.session.agent.abort("Cancelled by user");
        // The active prompt's finally block would also emit done via the guard,
        // but we mark + emit here so cancel is resolved promptly even if the
        // abort does not propagate synchronously.
        handleCancelGuard(record.currentGuard, (e) => sendEvent(sessionId, e));

        send(id, { ok: true });
        return;
      }

      if (method === "destroy_session") {
        const sessionId: string = params?.session_id;
        const record = sessions.get(sessionId);
        if (!record) {
          sendError(id, `Session not found: ${sessionId}`);
          return;
        }

        record.unsubscribe();
        try {
          await record.session.dispose();
        } finally {
          await record.mcpManager?.disconnectAll().catch(() => {});
          sessions.delete(sessionId);
        }
        // Pending approvals are keyed by interaction_id (not session-scoped),
        // so the 5min timeout handles any orphaned promises.

        send(id, { ok: true });
        return;
      }

      if (method === "get_health") {
        send(id, { status: "ok", message: "sidecar running" });
        return;
      }

      if (method === "reload_mcp") {
        const sessionId: string = params?.session_id;
        if (!sessions.has(sessionId)) {
          sendError(id, `Session not found: ${sessionId}`);
          return;
        }
        // The Python API currently returns 409 for reload because it cannot
        // identify every live sidecar session. Keep this RPC explicit rather
        // than claiming a YAML write refreshed existing sessions.
        send(id, mcpReloadUnsupportedResponse());
        return;
      }

      if (method === "undo") {
        const sessionId: string = params?.session_id as string;
        const steps: number = (params?.steps as number) ?? 1;
        const record = sessions.get(sessionId);
        if (!record) {
          sendError(id, `Session not found: ${sessionId}`);
          return;
        }

        // Walk backwards counting complete `user → assistant` turns.
        // An assistant turn may include trailing `tool`/`function` messages,
        // so a turn boundary is the position just before a `user` message
        // that itself follows a complete assistant turn. We cut at the
        // boundary that drops exactly `steps` user-initiated turns without
        // leaving dangling tool_call/tool_result pairs.
        const messages = record.session.state.messages;
        const originalLen = messages.length;
        // BC-002: mirror compact's hasLeadingSystem preservation. A leading
        // system message must always survive an undo; replaceMessages([])
        // must never be called (silent state wipe).
        const hasLeadingSystem = originalLen > 0 &&
          (messages[0] as any)?.role === "system";
        let turnsRemoved = 0;
        let cutIndex = originalLen;
        // Scan from end to start; every time we step past a `user` message
        // we count one completed turn (the assistant reply that preceded it
        // from the caller's perspective is the one we are removing).
        for (let i = originalLen - 1; i >= 0; i--) {
          const role = (messages[i] as any)?.role;
          if (role === "user") {
            turnsRemoved += 1;
            cutIndex = i;
            if (turnsRemoved >= steps) break;
          }
        }
        // No-op when (a) we couldn't find `steps` user turns to remove, or
        // (b) the cut would land at/before index 0 with no leading system
        // message to keep — both cases previously produced
        // replaceMessages([]), silently wiping all conversation state.
        if (turnsRemoved < steps || (!hasLeadingSystem && cutIndex <= 0)) {
          send(id, { removed: 0, turns_removed: 0, detail: "no turns to undo" });
          return;
        }
        // Defensive: when a leading system message exists, ensure it is
        // preserved even if cutIndex would land on index 0.
        if (hasLeadingSystem && cutIndex < 1) cutIndex = 1;
        const remaining = messages.slice(0, cutIndex);
        const removed = originalLen - remaining.length;
        try {
          record.session.agent.replaceMessages(remaining);
        } catch (err) {
          sendError(id, `undo failed: ${err}`);
          return;
        }
        send(id, { removed, turns_removed: turnsRemoved });
        return;
      }

      if (method === "compact") {
        const sessionId: string = params?.session_id as string;
        const keepLast: number = (params?.keep_last as number) ?? 20;
        const record = sessions.get(sessionId);
        if (!record) {
          sendError(id, `Session not found: ${sessionId}`);
          return;
        }

        // Compact: truncate message history to the last `keepLast` entries,
        // always preserving a leading system message if present. The LLM
        // provider APIs require the first message to be `system` (when
        // present), so we keep it regardless of `keepLast`.
        const messages = record.session.state.messages;
        const originalLen = messages.length;
        const hasLeadingSystem = originalLen > 0 &&
          (messages[0] as any)?.role === "system";
        const head = hasLeadingSystem ? [messages[0]] : [];
        const tailSource = hasLeadingSystem ? messages.slice(1) : messages;
        const tail = tailSource.slice(-Math.max(0, keepLast));
        const remaining = head.concat(tail);
        const removed = originalLen - remaining.length;
        if (removed > 0) {
          try {
            record.session.agent.replaceMessages(remaining);
          } catch (err) {
            sendError(id, `compact failed: ${err}`);
            return;
          }
        }
        send(id, {
          compressed: removed > 0,
          removed_count: removed,
          detail: removed > 0 ? "压缩完成" : "无需压缩",
        });
        return;
      }

      if (method === "get_messages") {
        const sessionId: string = params?.session_id as string;
        const limit: number = (params?.limit as number) ?? 50;
        const record = sessions.get(sessionId);
        if (!record) {
          sendError(id, `Session not found: ${sessionId}`);
          return;
        }

        const messages = record.session.state.messages;
        const total = messages.length;
        // A4: limit<=0 应返回空（探活语义）。slice(-0)===slice(0) 会返回全量，
        // 后端用 limit=0 探活时每次搬运整段历史，与零成本探活意图相悖。
        const sliced = limit <= 0 ? [] : messages.slice(-Math.min(limit, total));
        const result = sliced.map((m: any) => {
          let content = "";
          if (typeof m.content === "string") {
            content = m.content;
          } else if (Array.isArray(m.content)) {
            content = m.content
              .filter((b: any) => b?.type === "text")
              .map((b: any) => b.text ?? "")
              .join("");
          }
          return { role: m.role ?? "unknown", content };
        });
        send(id, { messages: result, total });
        return;
      }

      if (method === "user_response") {
        const interactionId: string = params?.interaction_id;
        const response: string | string[] = params?.response;
        const pending = pendingApprovals.get(interactionId);
        if (!pending) {
          // Stale or unknown — respond ok so the frontend doesn't hang.
          send(id, { ok: true });
          return;
        }
        pendingApprovals.delete(interactionId);
        // Frontend sends "yes" (approve) / "no" (deny). Map to the choice the
        // oh-my-pi wrapper expects: "Approve" / anything-else-as-deny.
        const choice = response === "yes" ? "Approve" : "Deny";
        pending.resolve(choice);
        send(id, { ok: true });
        return;
      }

      // ── Settings RPC ──────────────────────────────────────

      if (method === "get_settings") {
        const targetSessionId: string | undefined = params?.session_id;
        const record = targetSessionId ? sessions.get(targetSessionId) : undefined;
        const settings = record?.settings ?? await ensureSettings();
        const paths: string[] = params?.paths ?? [];
        const result: Record<string, unknown> = {};
        for (const p of paths) {
          try { result[p] = settings.get(p as any); } catch { /* skip invalid path */ }
        }
        send(id, { settings: result });
        return;
      }

      if (method === "set_settings") {
        const targetSessionId: string | undefined = params?.session_id;
        const record = targetSessionId ? sessions.get(targetSessionId) : undefined;
        const settings = record?.settings ?? await ensureSettings();
        const settingPath: string = params?.path;
        const value: unknown = params?.value;
        if (!settingPath) {
          sendError(id, "Missing required parameter: path");
          return;
        }
        try {
          settings.set(settingPath as any, value as any);
          send(id, { ok: true });
        } catch (err) {
          sendError(id, `Failed to set setting: ${String(err)}`);
        }
        return;
      }

      // ── Capabilities RPC ──────────────────────────────────────

      if (method === "get_discovered_mcp") {
        // Return MCP server info from all active sessions
        const discovered: Array<{ name: string; transport: string; tool_count: number; status: string }> = [];
        for (const [sid, record] of sessions) {
          if (record.mcpConfigs) {
            for (const [name, cfg] of Object.entries(record.mcpConfigs)) {
              discovered.push({
                name,
                transport: (cfg as any).type ?? "unknown",
                tool_count: record.mcpToolNames?.length ?? 0,
                status: "connected",
              });
            }
          }
        }
        send(id, discovered);
        return;
      }

      if (method === "get_discovered_skills") {
        try {
          const { discoverSkills } = await import("@oh-my-pi/pi-coding-agent");
          const result = await discoverSkills();
          const skills = result.skills ?? [];
          // Return minimal serializable info
          send(id, skills.map((s: any) => ({
            name: s.name ?? "unknown",
            description: s.description ?? "",
            source: s.source ?? "auto",
          })));
        } catch {
          send(id, []);
        }
        return;
      }

      if (method === "get_discovered_extensions") {
        try {
          const { discoverExtensions } = await import("@oh-my-pi/pi-coding-agent");
          const result = await discoverExtensions();
          send(id, { loaded: result.loaded ?? 0, extensions: [] });
        } catch {
          send(id, { loaded: 0, extensions: [] });
        }
        return;
      }

      // ── Plugin RPC ──────────────────────────────────────────

      if (method === "list_plugins") {
        try {
          const { PluginManager } = await import("@oh-my-pi/pi-coding-agent");
          const pm = new PluginManager();
          const list = await pm.list();
          send(id, list.map((p: any) => ({
            name: p.name ?? "",
            version: p.version ?? "",
            description: p.description ?? "",
            enabled: p.enabled !== false,
            features: p.features ?? [],
            homepage: p.homepage ?? "",
          })));
        } catch (e: any) {
          send(id, []);
        }
        return;
      }

      if (method === "install_plugin") {
        try {
          const spec: string = params?.spec ?? "";
          if (!spec) { sendError(id, "Missing required parameter: spec"); return; }
          const { PluginManager } = await import("@oh-my-pi/pi-coding-agent");
          const pm = new PluginManager();
          const result = await pm.install(spec);
          send(id, { ok: true, plugin: result ?? null });
        } catch (e: any) {
          sendError(id, `Install failed: ${e.message ?? String(e)}`);
        }
        return;
      }

      if (method === "uninstall_plugin") {
        try {
          const name: string = params?.name ?? "";
          if (!name) { sendError(id, "Missing required parameter: name"); return; }
          const { PluginManager } = await import("@oh-my-pi/pi-coding-agent");
          const pm = new PluginManager();
          await pm.uninstall(name);
          send(id, { ok: true });
        } catch (e: any) {
          sendError(id, `Uninstall failed: ${e.message ?? String(e)}`);
        }
        return;
      }

      if (method === "set_plugin_enabled") {
        try {
          const name: string = params?.name ?? "";
          const enabled: boolean = params?.enabled !== false;
          if (!name) { sendError(id, "Missing required parameter: name"); return; }
          const { PluginManager } = await import("@oh-my-pi/pi-coding-agent");
          const pm = new PluginManager();
          await pm.setEnabled(name, enabled);
          send(id, { ok: true });
        } catch (e: any) {
          sendError(id, `Failed to toggle plugin: ${e.message ?? String(e)}`);
        }
        return;
      }

      sendError(id, `Unknown method: ${method}`);
    } catch (err) {
      sendError(id, String(err));
    }
  });

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
