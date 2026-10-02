/**
 * kernel/events.ts — pi AgentSessionEvent → Maxma WS 事件映射（阶段一 §6.2 任务 1）。
 *
 * 词表严格对齐 docs/contracts/ws-events.md §3.1；pi 侧事件形状来自官方类型：
 *   - core:  @earendil-works/pi-agent-core AgentEvent（message_update / tool_execution 系列 / message_end…）
 *   - 扩展:  pi-coding-agent AgentSessionEvent（agent_settled / compaction 系列 / auto_retry 系列 / queue_update…）
 *
 * 与 OMP 版（src/events.ts）的三处语义差异（均为官方语义，非自创）：
 *   1. done 改由 agent_settled 触发——官方文档：agent_end 后自动重试/排队任务
 *      仍可能继续，agent_settled 才是"不会再继续"的终态。
 *   2. 压缩事件名：pi 为 compaction_start/compaction_end（OMP 为 auto_compaction_*）；
 *      pi 无 action/skipped 字段，按契约默认值填充。
 *   3. OMP 专有事件（goal_updated/todo_reminder/irc_message/sub_session_created 等）
 *      在 pi 中不存在，不映射（显式 null）。
 *   auto_retry_start/end 与 OMP 同名同字段，直接映射。
 */

/** 与 src/state.ts DoneGuard 结构等价（kernel 不依赖 OMP state）。 */
export interface PiDoneGuard {
  done: boolean;
}

/** Maxma WS 事件的最小形状（kernel 不依赖 rpc-types）。 */
export interface MaxmaEventLike {
  type: string;
  payload: Record<string, unknown>;
}

/** 工具执行耗时测算（与 OMP 版 toolStartTimestamps 同语义，kernel 自持）。 */
const toolStartTimestamps = new Map<string, number>();

interface PiMessageLike {
  content?: string | Array<{ type?: string; text?: string }>;
}

/** 从消息 content 提取纯文本（与 OMP 版 message_end 处理一致）。 */
function extractText(msg?: PiMessageLike): string {
  if (!msg?.content) return "";
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((b): b is { type: string; text: string } => b?.type === "text")
      .map((b) => b.text)
      .join("");
  }
  return "";
}

const COMPACTION_REASONS = ["threshold", "overflow", "idle", "incomplete"];

export function mapPiAgentEventToMaxma(
  event: unknown,
  guard?: PiDoneGuard | null,
): MaxmaEventLike | null {
  const e = event as { type?: string } & Record<string, any>;
  const type = e?.type;
  if (!type) return null;

  // ── 流式输出（message_update.assistantMessageEvent，官方 AssistantMessageEvent）──
  if (type === "message_update") {
    const ae = e.assistantMessageEvent as
      | { type?: string; delta?: string; content?: string; error?: PiMessageLike }
      | undefined;
    if (!ae?.type) return null;

    if (ae.type === "text_delta") {
      return { type: "token", payload: { token: ae.delta ?? "" } };
    }
    if (ae.type === "thinking_start") {
      return { type: "thinking_start", payload: {} };
    }
    if (ae.type === "thinking_delta") {
      return { type: "thinking_delta", payload: { delta: ae.delta ?? "" } };
    }
    if (ae.type === "thinking_end") {
      return { type: "thinking_end", payload: { content: ae.content ?? "" } };
    }
    // 官方 error 事件：error 字段为 AssistantMessage，文本在 content blocks 中
    if (ae.type === "error") {
      return {
        type: "error",
        payload: { code: "AGENT_ERROR", message: extractText(ae.error) || "Unknown agent error" },
      };
    }
    // start/text_start/text_end/toolcall_* /done：执行数据由 tool_execution_* 事件
    // 承载（与 OMP 版相同——跳过预执行 toolcall 事件避免重复/空名事件）
    return null;
  }

  // ── 工具执行 ──
  if (type === "tool_execution_start") {
    if (e.toolCallId) toolStartTimestamps.set(e.toolCallId, Date.now());
    return {
      type: "tool_start",
      payload: {
        tool_name: e.toolName ?? "",
        input: JSON.stringify(e.args ?? {}),
      },
    };
  }

  if (type === "tool_execution_update") {
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
    const startMs = e.toolCallId ? toolStartTimestamps.get(e.toolCallId) : undefined;
    if (e.toolCallId) toolStartTimestamps.delete(e.toolCallId);
    const elapsed = startMs !== undefined ? Math.round((Date.now() - startMs) / 1000) : 0;
    if (e.isError === true) {
      return {
        type: "tool_error",
        payload: { tool_name: e.toolName ?? "", error: JSON.stringify(e.result ?? {}), elapsed },
      };
    }
    return {
      type: "tool_end",
      payload: { tool_name: e.toolName ?? "", output: JSON.stringify(e.result ?? {}), elapsed },
    };
  }

  // ── 回答（message_end 携带权威完成消息）──
  if (type === "message_end") {
    const message = e.message as PiMessageLike & { usage?: Record<string, unknown> };
    const usage = message?.usage;
    return {
      type: "answer",
      payload: {
        content: extractText(message),
        ...(usage && typeof usage === "object" ? { usage } : {}),
      },
    };
  }

  // ── 回合终态：agent_settled（官方：不会再自动继续）→ done ──
  if (type === "agent_settled") {
    if (guard?.done) return null; // DONE-DUP-001：cancel/超时已发过 done
    if (guard) guard.done = true;
    return { type: "done", payload: {} };
  }

  // agent_end（pi 语义：单次底层运行结束，重试/排队后可能继续）→ 不发 done
  if (type === "agent_end") {
    return null;
  }

  // ── 压缩（pi: compaction_start/compaction_end）──
  if (type === "compaction_start") {
    const reason = e.reason ?? "threshold";
    return {
      type: "context_compressing",
      payload: {
        reason: (COMPACTION_REASONS.includes(reason) ? reason : "threshold") as string,
        action: "context-full",
      },
    };
  }

  if (type === "compaction_end") {
    const result = e.result as { summary?: string; tokensBefore?: number } | undefined;
    return {
      type: "context_compressed",
      payload: {
        summary_preview: (result?.summary ?? "").slice(0, 200),
        before_tokens: result?.tokensBefore,
        action: "context-full",
        skipped: false,
        aborted: e.aborted ?? false,
        will_retry: e.willRetry ?? false,
        error_message: e.errorMessage,
      },
    };
  }

  // ── 自动重试（与 OMP 同名同字段，直接映射）──
  if (type === "auto_retry_start") {
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
    return {
      type: "retry_end",
      payload: {
        success: e.success ?? false,
        attempt: e.attempt ?? 0,
        final_error: e.finalError,
      },
    };
  }

  // 其余 pi 事件（queue_update/turn_*/message_start/entry_appended/
  // session_info_changed/thinking_level_changed/summarization_retry_scheduled…）
  // 无 Maxma 等价事件，显式忽略。
  return null;
}
