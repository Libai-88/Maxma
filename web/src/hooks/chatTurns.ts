/**
 * hooks/chatTurns.ts — 对话轮次的**纯函数层**（从 useChat.ts 抽出，2026-11-17）。
 *
 * 为什么单独成文件：useChat.ts 原来 2842 行、没有任何测试，但其中真正承载
 * 历史缺陷的那几段（后端历史 → 轮次重建、旧缓存迁移、事件扫描、重连退避）
 * 全是**不碰 DOM / 不碰 WS** 的纯函数。抽出来之后它们能在 `bun test` 里直测，
 * 不必为了跑一条断言去启动 React、store 与 WS。
 *
 * 纪律：本文件只做纯计算，不许 import store / api / DOM / React。
 * 一旦某个函数需要读状态或发请求，它就不属于这里。
 */

import type { ChatTurn, ToolCall, ThinkingBlock, TurnEvent, MemoryToolEvent, PiUsage } from '@/types'
import type { SessionChannel } from '@/stores/chat'
import { parseReferences } from '@/utils/references'

/** 用户消息尾部的时间后缀（发送时附加，历史回看要剥掉）。 */
export const TIME_SUFFIX_RE = /（\d{4}-\d{2}-\d{2} \w{3} \d{2}:\d{2}）$/

/** 并发执行 map 回调，最多 limit 个同时在途（PERF-HYDRATE-001）。 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const idx = next++
      results[idx] = await fn(items[idx])
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

/** 会话 ID 格式验证：由后端 uuid.uuid4().hex 生成（32 位 hex，无连字符）。 */
const SID_RE = /^[0-9a-f]{32}$/i

export function isValidSessionId(sid: string): boolean {
  return SID_RE.test(sid)
}

/** 计算指数退避延迟（毫秒）：1s → 2s → 4s → 8s → … → 最大 30s，附加 ±25% jitter 防 thundering herd。 */
export function getReconnectDelay(attempts: number): number {
  const base = 1000
  const maxDelay = 30000
  const raw = Math.min(base * Math.pow(2, attempts), maxDelay)
  const jitter = 0.75 + Math.random() * 0.5
  return Math.round(raw * jitter)
}

/** 后端返回的 [{role, content}] 形状（pi 的 assistant 消息自带用量元数据）。 */
export interface BackendMessage {
  role: string
  content: string
  usage?: PiUsage | null
  provider?: string | null
  model?: string | null
  timestamp?: number
}

/**
 * 后端历史 → ChatTurn[]（一轮 = 1 human + 后续所有非 human 消息）。
 *
 * HISTORY-REFS-001：发送时附加的时间尾缀与 `__refs__` JSON 标记必须在这里剥掉，
 * 否则用户气泡会原样显示序列化内容、引用 chip 丢失。
 * 用量按轮汇总：同轮多条 ai 消息的 input/output/cache 相加，provider/model 取最后一条。
 */
export function backendMessagesToTurns(sid: string, messages: BackendMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = []
  let i = 0
  while (i < messages.length) {
    const msg = messages[i]
    if (msg.role === 'human') {
      const { cleanText, refs } = parseReferences(msg.content || '')
      const userMessage = refs.length > 0 ? cleanText : (msg.content || '').replace(TIME_SUFFIX_RE, '')
      const turn: ChatTurn = {
        id: `history-${sid}-${i}`,
        userMessage,
        refs,
        events: [],
        memoryEvents: [],
        finalAnswer: null,
      }
      i++
      const aiContents: string[] = []
      const aiUsages: BackendMessage[] = []
      const startedAt = typeof msg.timestamp === 'number' ? msg.timestamp : null
      let lastAiTimestamp: number | null = null
      while (i < messages.length && messages[i].role !== 'human') {
        const m = messages[i]
        if (m.role === 'ai' && m.content) {
          aiContents.push(m.content)
        }
        if (m.role === 'ai' && m.usage) {
          aiUsages.push(m)
          if (typeof m.timestamp === 'number') lastAiTimestamp = m.timestamp
        }
        // tool 消息跳过（历史回看不需要显示工具调用细节）
        i++
      }
      if (aiUsages.length > 0) {
        const n = (v: unknown): number | null =>
          typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
        const sum = (key: keyof PiUsage): number | null => {
          let total: number | null = null
          for (const m of aiUsages) {
            const v = n(m.usage?.[key])
            if (v !== null) total = (total ?? 0) + v
          }
          return total
        }
        const last = aiUsages[aiUsages.length - 1]
        const cacheObserved = n(last.usage?.cacheRead) !== null || n(last.usage?.cacheWrite) !== null
        turn.usage = {
          provider: last.provider ?? null,
          model: last.model ?? null,
          inputTokens: sum('input'),
          outputTokens: sum('output'),
          cacheReadTokens: sum('cacheRead'),
          cacheWriteTokens: sum('cacheWrite'),
          durationMs: startedAt !== null && lastAiTimestamp !== null
            ? Math.max(0, lastAiTimestamp - startedAt)
            : null,
          cacheStatus: cacheObserved ? 'observed' : null,
          priceStatus: null,
          requests: aiUsages.length,
          warmCalls: 0,
        }
      }
      turn.finalAnswer = aiContents.length > 0 ? aiContents[aiContents.length - 1] : null
      // 兜底：整轮没有文字回复（取消/工具失败后图直接结束）时给占位，
      // 避免用户感知为「整轮对话被吞掉」。
      if (!turn.finalAnswer) {
        turn.finalAnswer = '（这一轮处理未生成文字回复，请查看工具执行结果或重新提问。）'
      }
      turns.push(turn)
    } else {
      // 非 human 消息但没有前置 human（异常情况），跳过
      i++
    }
  }
  return turns
}

/** 旧格式 turn 迁移：补齐 refs 与 memoryEvents，并剥掉时间尾缀。 */
export function migrateLegacyTurn(turn: Record<string, unknown>): ChatTurn {
  if (Array.isArray(turn.refs)) {
    return { memoryEvents: [], ...turn } as unknown as ChatTurn
  }
  const prevMsg = (turn.userMessage ?? '') as string
  const { cleanText, refs } = parseReferences(prevMsg || '')
  const text = refs.length > 0 ? cleanText : prevMsg.replace(TIME_SUFFIX_RE, '')
  return { ...turn, userMessage: text, refs, memoryEvents: [] } as unknown as ChatTurn
}

// ── 事件扫描（THINK-SPLIT-001 / approval 归属）────────────────

export function findLastThinking(events: TurnEvent[]): ThinkingBlock | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === 'thinking') {
      return events[i] as ThinkingBlock
    }
  }
  return undefined
}

/**
 * 找最后一个**纯思考**块（becameAnswer=false）。
 * pi 的 `thinking_end` 在全部 `text_delta` 之后才到，此时最后一块已是流式答案块；
 * 若用 findLastThinking 会把答案块标成 done，真正的思考块永远停在做不完的转圈。
 */
export function findLastPureThinking(events: TurnEvent[]): ThinkingBlock | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.kind === 'thinking' && !(e as ThinkingBlock).becameAnswer) {
      return e as ThinkingBlock
    }
  }
  return undefined
}

export function findRunningTool(events: TurnEvent[], toolName: string): ToolCall | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.kind === 'tool' && e.name === toolName && e.status === 'running') {
      return e as ToolCall
    }
  }
  return undefined
}

/**
 * 按引擎的 toolCallId 找那次调用。
 * 只按工具名匹配会让「同一轮连续两次 bash」的第二张审批卡覆盖第一张，
 * 第一张从此没有入口（引擎在等它、界面却只剩后来那张）。
 */
export function findToolCallByCallId(events: TurnEvent[], callId: string | undefined): ToolCall | undefined {
  if (!callId) return undefined
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.kind === 'tool' && e.callId === callId) return e as ToolCall
  }
  return undefined
}

/** 工具事件的更新缓冲键（同一轮同名工具并行时按 callId 分开，避免输出串台）。 */
export function toolBufferKey(sid: string, turnId: string, toolName: string, callId: string | undefined): string {
  return `${sid}\0${turnId}\0${callId ?? toolName}`
}

/** 通过后端 turn_id 查找 turn（先 currentTurn，再 turns）。 */
export function findTurnByBackendId(ch: SessionChannel, turnId: string): ChatTurn | undefined {
  if (ch.currentTurn?.turnId === turnId) return ch.currentTurn
  return ch.turns.find(t => t.turnId === turnId)
}

/** 在 memoryEvents 中查找指定工具名的 running 事件。 */
export function findRunningMemoryTool(events: MemoryToolEvent[], toolName: string): MemoryToolEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.name === toolName && e.status === 'running') return e
  }
  return undefined
}
