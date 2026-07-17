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
 *
 * Events are forwarded as JSON-RPC notifications (method: "event").
 */

import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import type { Model } from "@oh-my-pi/pi-ai";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent";
import { registerCustomTools } from "./tools/index";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionRecord {
  session: AgentSession;
  unsubscribe: () => void;
  promptQueue: Promise<void>;  // serializes concurrent prompt calls
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const sessions = new Map<string, SessionRecord>();
const rl = createInterface({ input: process.stdin });

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
function parseModel(modelStr: string): Model {
  const slashIdx = modelStr.indexOf("/");
  const provider = slashIdx >= 0 ? modelStr.slice(0, slashIdx) : "";
  const modelId = slashIdx >= 0 ? modelStr.slice(slashIdx + 1) : modelStr;

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
  const baseUrl =
    process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
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
      thinkingFormat: "disabled" as const,
      reasoningDisableMode: "off" as const,
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

export function mapPiEventToMaxma(
  piEvent: Record<string, unknown>,
  guard?: { done: boolean } | null,
): Record<string, unknown> | null {
  // Handle AgentEvent types directly
  const type = piEvent.type as string;

  if (type === "message_update") {
    const assistantEvent = (piEvent as any).assistantMessageEvent;
    if (!assistantEvent) return null;

    const aeType = assistantEvent.type as string;

    if (aeType === "text_delta") {
      return {
        type: "token",
        payload: { token: assistantEvent.delta ?? "" },
      };
    }

    // NOTE: toolcall_start/toolcall_end from message_update are pre-execution
    // events (LLM deciding to call a tool). The actual execution data comes
    // from tool_execution_start/tool_execution_end below, which carry full
    // toolName and result data. Skip early message_update tool events to avoid
    // duplicate/empty-named events.

    if (aeType === "error") {
      const errMsg =
        (assistantEvent as any).error?.content?.[0]?.text ??
        "Unknown agent error";
      return {
        type: "error",
        payload: { code: "AGENT_ERROR", message: errMsg },
      };
    }

    return null;
  }

  if (type === "tool_execution_start") {
    const e = piEvent as any;
    return {
      type: "tool_start",
      payload: {
        tool_name: e.toolName ?? "",
        input: JSON.stringify(e.args ?? {}),
      },
    };
  }

  if (type === "tool_execution_end") {
    const e = piEvent as any;
    const isError = e.isError === true;
    if (isError) {
      return {
        type: "tool_error",
        payload: {
          tool_name: e.toolName ?? "",
          error: JSON.stringify(e.result ?? {}),
          elapsed: 0,
        },
      };
    }
    return {
      type: "tool_end",
      payload: {
        tool_name: e.toolName ?? "",
        output: JSON.stringify(e.result ?? {}),
        elapsed: 0,
      },
    };
  }

  if (type === "message_end") {
    const msg = (piEvent as any).message;
    let content = "";
    if (msg?.content) {
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .map((b: any) => (b?.type === "text" ? b.text : ""))
          .join("");
      }
    }
    return {
      type: "answer",
      payload: { content },
    };
  }

  if (type === "agent_end") {
    if (guard) guard.done = true;
    return { type: "done", payload: {} };
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

// ---------------------------------------------------------------------------
// Main event subscriber
// ---------------------------------------------------------------------------

function subscribeSession(
  sessionId: string,
  session: AgentSession,
): () => void {
  return session.subscribe((event: any) => {
    const mapped = mapPiEventToMaxma(event as Record<string, unknown>);
    if (mapped) {
      sendEvent(sessionId, mapped);
    }
  });
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
        const model = parseModel(modelStr);
        const cwd: string = params?.cwd ?? process.cwd();
        const systemPrompt: string | undefined = params?.system_prompt;
        const tools: string[] | undefined = params?.tools as string[] | undefined;

        const createOptions: Record<string, unknown> = {
          model,
          cwd,
        };
        if (systemPrompt !== undefined) {
          createOptions.systemPrompt = systemPrompt;
        }
        if (tools !== undefined && Array.isArray(tools) && tools.length > 0) {
          createOptions.toolNames = tools;
        }

        // Register custom Maxma tools
        const customTools = registerCustomTools();
        if (customTools.length > 0) {
          createOptions.customTools = customTools;
        }

        const { session } = await createAgentSession(createOptions as any);
        const sessionId = randomUUID();

        const unsubscribe = subscribeSession(sessionId, session);
        sessions.set(sessionId, { session, unsubscribe, promptQueue: Promise.resolve() });

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
        record.promptQueue = record.promptQueue
          .catch(() => {})
          .then(() => record.session.prompt(message).catch((err: unknown) => {
            sendEvent(sessionId, {
              type: "error",
              payload: { code: "PROMPT_ERROR", message: String(err) },
            });
            // BUG3 fix: always send done after error so Python doesn't hang
            sendEvent(sessionId, { type: "done", payload: {} });
          }));

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
        // BUG4 fix: send done event so Python's turn_done.wait() unblocks
        sendEvent(sessionId, { type: "done", payload: {} });

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
        await record.session.dispose();
        sessions.delete(sessionId);

        send(id, { ok: true });
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

        // Truncate the last N assistant+user message pairs (copy-first to avoid mutating internal state)
        const originalLen = record.session.state.messages.length;
        const keepCount = Math.max(0, originalLen - steps * 2);
        const remaining = record.session.state.messages.slice(0, keepCount);
        const removed = originalLen - keepCount;
        record.session.replace_messages(remaining);
        send(id, { removed });
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
        const sliced = messages.slice(-limit);
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

      sendError(id, `Unknown method: ${method}`);
    } catch (err) {
      sendError(id, String(err));
    }
  });

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
