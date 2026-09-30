/**
 * kernel/prompt.ts — pi 会话的 prompt 编排（阶段一 §6.2 任务 1 配套）。
 *
 * 语义镜像 OMP 版 orchestratePrompt（src/events.ts）的两项修复，差异仅在
 * 官方 abort 签名（pi 为无参 abort()）：
 *   - PROMPT-WEDGE-001：超时 emit error+done 后 abort，再给 3s 宽限解除
 *     promptQueue 阻塞，避免会话功能性死锁；
 *   - TIMEOUT-ABORT-001：超时用 AgentSession.abort()（官方：abort 活动操作
 *     并等待 idle），与 cancel 语义一致。
 */

export interface PiDoneGuard {
  done: boolean;
}

/** pi AgentSession 的 prompt/abort 最小结构面（官方签名）。 */
export interface PiPromptCapableSession {
  prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp" }): Promise<void>;
  abort(): Promise<void>;
}

export async function orchestratePiPrompt(
  session: PiPromptCapableSession,
  message: string,
  guard: PiDoneGuard,
  sink: (event: { type: string; payload: Record<string, unknown> }) => void,
  timeoutMs: number = 600_000,
): Promise<void> {
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    if (guard.done) return;
    timedOut = true;
    guard.done = true;
    sink({
      type: "error",
      payload: { code: "PROMPT_TIMEOUT", message: `Prompt exceeded ${timeoutMs}ms limit` },
    });
    sink({ type: "done", payload: {} });
    // 官方 abort()：停止活动操作并等待 idle
    void session.abort().catch(() => {});
  }, timeoutMs);

  try {
    await Promise.race([
      session.prompt(message),
      new Promise<void>((resolve) => {
        // 仅超时后生效：等待 abort 传播的宽限期，随后解除队列阻塞
        if (!timedOut) return;
        setTimeout(resolve, 3000);
      }),
    ]);
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
 * cancel 语义（镜像 OMP 版 handleCancelGuard）：
 *   - guard 活跃且未 done → 置 done + 发 done（prompt 的 finally 变 no-op）
 *   - 已 done → no-op（agent_settled/超时已发）
 *   - 空闲（无 guard）→ 兼容性补发一次 done
 * 调用方需另行 await session.abort()（官方：停止并等待 idle）。
 */
export function handlePiCancelGuard(
  guard: PiDoneGuard | null,
  sink: (event: { type: string; payload: Record<string, unknown> }) => void,
): void {
  if (guard && guard.done) return;
  if (guard) guard.done = true;
  sink({ type: "done", payload: {} });
}
