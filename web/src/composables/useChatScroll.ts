import { nextTick, onUnmounted, ref, watch, type Ref } from 'vue'
import { chatSessionAliveCache } from '@/composables/sessionAliveCache'
import type { ChatTurn } from '@/types'

interface ScrollerInstance {
  scrollToBottom: () => void
  scrollToItem: (index: number, options?: { align?: string; smooth?: boolean; offset?: number }) => void
  scrollToPosition: (position: number, options?: { align?: string; smooth?: boolean; offset?: number }) => void
}

interface UseChatScrollOptions {
  sessionId: Ref<string>
  turns: Ref<ChatTurn[]>
  currentTurn: Ref<ChatTurn | null>
}

/**
 * 聊天窗口滚动行为管理：
 * - 维护 "是否接近底部" 状态
 * - 新消息/流式 token 到达时自动滚动
 * - 会话切换时保存/恢复滚动位置
 * - 批量挂载时的交错入场动画窗口
 */
export function useChatScroll({ sessionId, turns, currentTurn }: UseChatScrollOptions) {
  const scrollerRef = ref<ScrollerInstance | null>(null)
  const SCROLL_BOTTOM_THRESHOLD = 100
  const isNearBottomRef = ref(true)

  // ── 滚动事件处理 ──

  /** DynamicScroller 根元素的 scroll 事件：维护 isNearBottomRef 状态 */
  function onScrollerScroll(e: Event) {
    const el = e.target as HTMLElement
    if (!el) return
    isNearBottomRef.value =
      el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD
  }

  function isNearBottom(): boolean {
    return isNearBottomRef.value
  }

  function scrollToBottom() {
    nextTick(() => {
      scrollerRef.value?.scrollToBottom()
    })
  }

  function scrollToTurn(index: number) {
    scrollerRef.value?.scrollToItem(index, { align: 'start', smooth: true })
  }

  // ── 流式 token 签名 ──

  /** 返回所有 thinking block 的 tokens 长度总和，用于触发自动滚动和 size-dependencies */
  function streamingTokensSignature(turn: ChatTurn): number {
    let total = 0
    for (const ev of turn.events) {
      if (ev.kind === 'thinking' && typeof ev.tokens === 'string') {
        total += ev.tokens.length
      }
    }
    return total
  }

  // ── Watchers ──

  // 会话切换：保存/恢复滚动位置 + 开启交错窗口
  watch(
    sessionId,
    (sid, previousSessionId) => {
      if (previousSessionId) {
        const scrollerEl = (scrollerRef.value as unknown as { $el?: HTMLElement } | null)?.$el
        if (scrollerEl) {
          chatSessionAliveCache.rememberScroll(previousSessionId, scrollerEl.scrollTop)
        }
      }
      if (!sid) return
      nextTick(() => {
        const savedScrollTop = chatSessionAliveCache.restoreScroll(sid)
        if (savedScrollTop != null && savedScrollTop > 0) {
          scrollerRef.value?.scrollToPosition(savedScrollTop)
        } else {
          scrollerRef.value?.scrollToBottom()
        }
      })
    },
    { immediate: true },
  )

  // 新轮次到达
  watch(() => turns.value.length, () => {
    if (isNearBottom()) scrollToBottom()
  })

  // 新事件到达
  watch(
    () => currentTurn.value?.events.length,
    () => {
      if (isNearBottom()) scrollToBottom()
    },
  )

  // finalAnswer 到达
  watch(
    () => currentTurn.value?.finalAnswer,
    () => {
      if (isNearBottom()) scrollToBottom()
    },
  )

  // 流式 token 累加（不改变 events.length，须单独监听）
  watch(
    () => currentTurn.value ? streamingTokensSignature(currentTurn.value) : 0,
    () => {
      if (isNearBottom()) scrollToBottom()
    },
  )

  // ── 清理 ──

  onUnmounted(() => {
    if (sessionId.value) {
      const scrollerEl = (scrollerRef.value as unknown as { $el?: HTMLElement } | null)?.$el
      if (scrollerEl) {
        chatSessionAliveCache.rememberScroll(sessionId.value, scrollerEl.scrollTop)
      }
    }
  })

  return {
    scrollerRef,
    isNearBottomRef,
    onScrollerScroll,
    isNearBottom,
    scrollToBottom,
    scrollToTurn,
    streamingTokensSignature,
  }
}
