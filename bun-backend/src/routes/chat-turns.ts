/**
 * routes/chat-turns.ts — 回合 id 校验与上下文用量估算
 * （api/routes/chat_turns.py 的 Bun 直译，阶段二 2.3b）。
 */

import { randomUUID } from "node:crypto";

/** 校验客户端 turn_id（非空且 ≤128 字符），否则生成 uuid4 hex。 */
export function newTurnId(turnId?: unknown): string {
  if (typeof turnId === "string") {
    const candidate = turnId.trim();
    if (candidate && candidate.length <= 128) return candidate;
  }
  return randomUUID().replace(/-/g, "");
}

export interface ContextUsage {
  estimated_tokens: number;
  max_tokens: number;
  percentage: number;
  message_count: number;
  model_name: string;
}

/** 从消息列表估算上下文用量（chars/2 ≈ tokens，与 Python 版同粗估口径）。 */
export function calculateContextUsage(
  messages: Array<Record<string, unknown>>,
  systemPrompt: string,
  opts: { maxTokens?: number; modelName?: string } = {},
): ContextUsage {
  const maxTokens = opts.maxTokens ?? 256_000;
  const modelName = opts.modelName ?? "";
  let totalChars = messages.reduce((acc, m) => acc + String(m.content ?? "").length, 0);
  totalChars += (systemPrompt ?? "").length;
  const estimatedTokens = Math.floor(totalChars / 2);
  return {
    estimated_tokens: estimatedTokens,
    max_tokens: maxTokens,
    percentage: Math.min(100, Math.floor((estimatedTokens / Math.max(maxTokens, 1)) * 100)),
    message_count: messages.length,
    model_name: modelName,
  };
}
