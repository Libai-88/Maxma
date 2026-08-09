/**
 * events.ts — OMP 事件 → Maxma 事件映射、prompt 编排与历史操作纯函数。
 */
import type { AgentSession } from "@oh-my-pi/pi-coding-agent";
import type { DoneGuard } from "./state";
import { bridgeState } from "./state";

const _toolStartTimestamps = bridgeState.toolStartTimestamps;

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

interface OmpAutoCompactionEndEvent {
  result?: { shortSummary?: string; summary?: string; tokensBefore?: number };
  action?: string;
  skipped?: boolean;
  aborted?: boolean;
  willRetry?: boolean;
  errorMessage?: string;
}

interface OmpAutoCompactionStartEvent {
  reason?: string;
  action?: string;
}

interface OmpAutoRetryEvent {
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  errorMessage?: string;
  success?: boolean;
  finalError?: unknown;
}

interface OmpTodoReminderEvent {
  todos?: Array<{ content?: string; status?: string }>;
  attempt?: number;
  maxAttempts?: number;
}

interface OmpIrcMessageEvent {
  message?: { from?: string; to?: string; body?: string; id?: string };
}

interface OmpNoticeEvent {
  level?: string;
  message?: string;
  source?: unknown;
}

export function mapPiEventToMaxma(
  piEvent: Record<string, unknown>,
  guard?: DoneGuard | null,
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

  // Sub-session creation (call_sub_agent)
  if (type === "sub_session_created") {
    const e = piEvent as Record<string, unknown>;
    return {
      type: "sub_session_created",
      payload: {
        sub_session_id: String(e.sub_session_id ?? ""),
        parent_session_id: String(e.parent_session_id ?? ""),
        task: String(e.task ?? ""),
        name: String(e.name ?? ""),
      },
    };
  }

  // Deferred sub-agent submitted
  if (type === "deferred_subagent_submitted") {
    const e = piEvent as Record<string, unknown>;
    return {
      type: "deferred_subagent_submitted",
      payload: {
        run_id: String(e.run_id ?? ""),
      },
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Per-prompt done guard + orchestration
// ---------------------------------------------------------------------------

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
// Pure history-manipulation helpers (undo / compact)
// ---------------------------------------------------------------------------

export interface TurnCutResult {
  /** Index at which to cut messages (slice(0, cutIndex)). */
  cutIndex: number;
  /** Number of complete user-initiated turns that would be removed. */
  turnsRemoved: number;
  /** Whether an undo is allowed (enough turns + no leading-system wipe risk). */
  canUndo: boolean;
}

/**
 * Compute where `undo` should cut the message history.
 *
 * Walks backwards counting complete `user → assistant` turns. An assistant
 * turn may include trailing `tool`/`function` messages, so a turn boundary is
 * the position just before a `user` message that itself follows a complete
 * assistant turn. We cut at the boundary that drops exactly `steps`
 * user-initiated turns without leaving dangling tool_call/tool_result pairs.
 *
 * BC-002: a leading system message must always survive an undo —
 * `replaceMessages([])` must never be called (silent state wipe).
 */
export function computeUndoTurnCut(messages: readonly { role?: string }[], steps: number): TurnCutResult {
  const originalLen = messages.length;
  const hasLeadingSystem = originalLen > 0 && messages[0]?.role === "system";
  let turnsRemoved = 0;
  let cutIndex = originalLen;
  for (let i = originalLen - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      turnsRemoved += 1;
      cutIndex = i;
      if (turnsRemoved >= steps) break;
    }
  }
  if (turnsRemoved < steps || (!hasLeadingSystem && cutIndex <= 0)) {
    return { cutIndex: originalLen, turnsRemoved: 0, canUndo: false };
  }
  if (hasLeadingSystem && cutIndex < 1) cutIndex = 1;
  return { cutIndex, turnsRemoved, canUndo: true };
}

export interface CompactResult<T> {
  /** Remaining messages after compaction (leading system preserved). */
  remaining: T[];
  /** Number of messages removed. */
  removed: number;
}

/**
 * Compact message history to the last `keepLast` entries, always preserving a
 * leading system message if present (provider APIs require the first message
 * to be `system` when present).
 */
export function compactMessages<T extends { role?: string }>(
  messages: readonly T[],
  keepLast: number,
): CompactResult<T> {
  const originalLen = messages.length;
  const hasLeadingSystem = originalLen > 0 && messages[0]?.role === "system";
  const head = (hasLeadingSystem ? [messages[0] as T] : []) as T[];
  const tailSource = hasLeadingSystem ? messages.slice(1) : messages;
  // A4-class fix: slice(-0) === slice(0) returns the FULL array, so keepLast<=0
  // must be special-cased to an empty tail (otherwise "compact to 0" no-ops).
  const keep = Math.max(0, keepLast);
  const tail = keep === 0 ? [] : tailSource.slice(-keep);
  const remaining = head.concat(tail as T[]);
  return { remaining, removed: originalLen - remaining.length };
}

/** Map a frontend user_response payload to the OMP wrapper's expected choice. */
export function resolveUserResponse(response: string | string[]): string {
  return response === "yes" ? "Approve" : "Deny";
}
