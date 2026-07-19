<template>
  <div class="chat-window" ref="windowRef">
    <!-- 虚拟列表：DynamicScroller 仅渲染视口内/附近的轮次，长对话性能大幅提升。
         #default 槽渲染每个轮次；#after 槽放错误/打字指示器；#empty 槽放空状态。
         :key="turn.id" 仍由 key-field="id" 提供，确保组件实例在流式→已完成过渡时不销毁重建。 -->
    <DynamicScroller
      ref="scrollerRef"
      class="messages-list"
      :items="mergedTurns"
      :min-item-size="200"
      key-field="id"
      @scroll="onScrollerScroll"
    >
      <template #default="{ item: turn, index: mergedIdx, active }">
        <DynamicScrollerItem
          :item="turn"
          :active="active"
          :index="mergedIdx"
          :size-dependencies="[
            turn.finalAnswer,
            turn.events.length,
            turn.userMessage,
            turn.memoryEvents ? turn.memoryEvents.length : 0,
          ]"
        >
          <div class="turn-wrapper">
            <div
              class="cite-source"
              :data-user-msg-idx="turnsIndex(mergedIdx)"
              @contextmenu.prevent="onBubbleContextMenu($event, 'user_message', turn.userMessage, '用户', turnsIndex(mergedIdx))"
            >
              <MessageBubble
                role="user"
                :content="turn.userMessage"
                :refs="turn.refs"
                :read-status="isStreamingTurn(turn) ? 'pending' : 'read'"
              />
            </div>
            <!-- 助手侧：events + finalAnswer + 记忆日志，hover 时才显示记忆日志 -->
            <div class="assistant-side">
              <!-- 计划确认卡片 -->
              <PlanCard
                v-if="turn.planCard"
                :plan="turn.planCard"
                @respond="onPlanRespond"
              />
              <SubAgentCard
                v-if="turn.deferredRunIds?.length"
                :session-id="sessionId"
                :run-ids="turn.deferredRunIds"
              />
              <template v-for="(ev, i) in turn.events" :key="i">
                <div
                  v-if="ev.kind === 'thinking' && !ev.consumed"
                  class="cite-source"
                  @contextmenu.prevent="onBubbleContextMenu($event, 'thinking', ev.tokens, '思考过程')"
                >
                  <ThinkingBlock :block="ev" />
                </div>
                <div
                  v-else-if="ev.kind === 'tool'"
                  class="cite-source"
                  @contextmenu.prevent="
                    onBubbleContextMenu(
                      $event,
                      'tool_result',
                      ev.output || ev.input || '',
                      ev.name,
                    )
                  "
                >
                  <!-- 审批请求（mode === 'approval'）且工具未完成：渲染 ApprovalBubble
                       - 审批等待中：显示允许/拒绝按钮
                       - 用户拒绝后：tool status 永远为 running，ApprovalBubble 显示 "已拒绝"
                       - 用户批准后工具执行完成（status='done'）：由 ToolBubbleRouter 渲染工具结果 -->
                  <ApprovalBubble
                    v-if="ev.interaction?.mode === 'approval' && ev.status === 'running'"
                    :tool-name="ev.name"
                    :detail="ev.interaction?.detail || ''"
                    :risk-level="ev.interaction?.risk_level || 'medium'"
                    :tool-input="ev.interaction?.tool_input"
                    :interaction-id="ev.interaction?.interactionId || ''"
                    @action="forwardAction"
                  />
                  <!-- 普通工具调用或审批后工具执行结果 -->
                  <ToolBubbleRouter v-else :tool-call="ev" @action="forwardAction" @pin="$emit('pin', $event)" />
                </div>
                <!-- 系统通知（如上下文压缩通知），轻量内联提示 -->
                <div
                  v-else-if="ev.kind === 'system'"
                  class="system-event-bubble"
                >
                  <span class="system-event-icon">ℹ︎</span>
                  <span class="system-event-text">{{ ev.content }}</span>
                </div>
              </template>
              <!-- finalAnswer：仅在已完成（非流式）轮次中展示 -->
              <div
                v-if="turn.finalAnswer && !hasAnswerBlock(turn) && !isStreamingTurn(turn)"
                class="cite-source"
                @contextmenu.prevent="onBubbleContextMenu($event, 'assistant_message', turn.finalAnswer, 'AI')"
              >
                <MessageBubble role="assistant" :content="turn.finalAnswer" />
              </div>
              <!-- 占位提示：finalAnswer 为空但轮次已完成（非流式）且有工具事件时，
                   显示一个轻量提示，避免用户感知为"整轮被吞掉" -->
              <div
                v-else-if="!turn.finalAnswer && !hasAnswerBlock(turn) && !isStreamingTurn(turn) && turn.events?.length"
                class="cite-source empty-reply-placeholder"
              >
                <MessageBubble role="assistant" content="（这一轮处理未生成文字回复，请查看上方工具执行结果或重新提问。）" />
              </div>
              <!-- 后台记忆更新日志（小字，轮次底部）—— 默认隐藏，hover 才显示 -->
              <div v-if="turn.memoryEvents?.length" class="memory-tool-log">
                <div
                  v-for="(me, i) in turn.memoryEvents"
                  :key="i"
                  class="memory-tool-entry"
                  :class="{ 'is-running': me.status === 'running' }"
                >
                  <span class="memory-tool-icon">
                    <span v-if="me.status === 'running'" class="memory-spinner"></span>
                    <span v-else-if="me.status === 'done'" class="memory-check">&#10003;</span>
                    <span v-else class="memory-cross">&#10007;</span>
                  </span>
                  <!-- memory_review = 未触发任何修改，显示简洁文字 -->
                  <template v-if="me.name === 'memory_review'">
                    <span class="memory-tool-name">记忆检查</span>
                    <span class="memory-tool-status">无需修改</span>
                  </template>
                  <!-- memory_processing = 后台 consumer 正在处理中 -->
                  <template v-else-if="me.name === 'memory_processing'">
                    <span class="memory-tool-name">记忆处理</span>
                    <span class="memory-tool-status">处理中...</span>
                  </template>
                  <template v-else>
                    <span class="memory-tool-name">{{ toolDisplayName(me.name) }}</span>
                    <span v-if="me.status === 'running'" class="memory-tool-status">处理中...</span>
                    <span v-else-if="me.status === 'done' && me.output" class="memory-tool-output" :title="me.output">{{ me.output }}</span>
                    <span v-else-if="me.status === 'error'" class="memory-tool-status is-error">失败</span>
                    <span v-if="me.elapsed !== null" class="memory-tool-elapsed">{{ me.elapsed.toFixed(1) }}s</span>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </DynamicScrollerItem>
      </template>

      <template #after>
        <!-- 错误提示 -->
        <div v-if="error" class="error-banner" :class="'error-' + (errorCategory || 'system')">
          <span class="error-icon">
            <template v-if="errorCategory === 'user_error'">⚠️</template>
            <template v-else-if="errorCategory === 'tool_error'">🔧</template>
            <template v-else-if="errorCategory === 'rate_limit'">⏳</template>
            <template v-else-if="errorCategory === 'cancelled'">⛔</template>
            <template v-else>❌</template>
          </span>
          <span class="error-message">{{ error }}</span>
          <span v-if="errorTraceId" class="error-trace-id">Trace: {{ errorTraceId }}</span>
          <button class="error-copy-btn" @click="copyErrorLog" :title="'复制错误日志'">
            <span v-if="copySuccess" class="copy-success">✓</span>
            <span v-else class="copy-icon"></span>
          </button>
        </div>

        <!-- 骨架屏：AI 正在生成回复 -->
        <div v-if="showSkeleton" class="message-skeleton" aria-label="AI 正在生成回复">
          <div class="skeleton-avatar"></div>
          <div class="skeleton-lines">
            <div class="skeleton-line skeleton-line--1"></div>
            <div class="skeleton-line skeleton-line--2"></div>
            <div class="skeleton-line skeleton-line--3"></div>
          </div>
        </div>

        <!-- 流式输出打字指示器 -->
        <div v-if="showTypingIndicator" class="typing-indicator">
          <span class="typing-label">饱饱正在输入</span>
          <span class="typing-dots">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
          </span>
        </div>
      </template>

      <template #empty>
        <!-- 空状态 -->
        <div v-if="turns.length === 0 && !currentTurn" class="empty-state" :style="emptyStateStyle">
          <div class="empty-state-overlay"></div>
          <div class="empty-state-content">
            <div class="empty-state-text">
              <p class="empty-title">开始和 Maxma 对话吧</p>
              <p class="empty-desc">
                <span class="typewriter">{{ displayedWord }}<span class="typewriter-cursor">|</span></span>
              </p>
            </div>
            <div class="quick-hints" data-qh>
              <span class="quick-hint">
                <span class="quick-hint-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg></span>
                单击开关侧栏
              </span>
              <span class="quick-hint" @click="togglePrivate">
                <span class="quick-hint-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
                <span><kbd>Ctrl</kbd> + <kbd>K</kbd> 切换私密模式</span>
              </span>
              <span class="quick-hint"> <!-- will be wired to new-session -->
                <span class="quick-hint-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg></span>
                点击 <kbd>+</kbd> 新建会话
              </span>
            </div>
          </div>
        </div>
      </template>
    </DynamicScroller>

    <!-- 用户消息滚动标记 -->
    <div class="scroll-marks" v-if="turns.length > 0">
      <div
        v-for="(turn, idx) in turns"
        :key="turn.id"
        class="scroll-mark"
        @click="scrollToTurn(idx)"
        :title="turn.userMessage.slice(0, 60)"
      />
    </div>

    <ContextMenu
      :position="ctxMenuPos"
      :items="ctxMenuItems"
      :visible="ctxMenuVisible"
      @select="handleContextMenuSelect"
      @close="closeContextMenu"
    />
  </div>
</template>

<script setup lang="ts">
import type { ChatTurn } from '@/types'
import type { ParsedRef } from '@/utils/references'
import { api } from '@/api'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useTheme } from '@/composables/useTheme'
import type { ContextMenuItem } from './ContextMenu.vue'
import ContextMenu from './ContextMenu.vue'
import MessageBubble from './MessageBubble.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import ToolBubbleRouter from './ToolBubbleRouter.vue'
import PlanCard from './PlanCard.vue'
import ApprovalBubble from './ApprovalBubble.vue'
import SubAgentCard from './SubAgentCard.vue'
import { toolDisplayName } from './tools/_shared/displayNames'
import { chatSessionAliveCache } from '@/composables/sessionAliveCache'
// 虚拟列表：仅渲染视口内/附近的轮次，长对话性能大幅提升
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'

const props = withDefaults(defineProps<{
  sessionId: string
  turns: ChatTurn[]
  currentTurn: ChatTurn | null
  error: string | null
  errorCategory: 'user_error' | 'tool_error' | 'system_error' | 'rate_limit' | 'cancelled' | null
  errorTraceId: string | null
}>(), {
  turns: () => [],
  currentTurn: null,
  error: null,
  errorCategory: null,
  errorTraceId: null,
})

// 错误日志一键复制（调用后端 ErrorCollector 获取完整报告）
const { isDark } = useTheme()
const copySuccess = ref(false)

const emptyStateStyle = computed(() => ({
  '--empty-bg-image': `url('@/assets/images/brand/empty-bg-${isDark.value ? 'night' : 'day'}.jpg')`,
}))

async function copyErrorLog() {
  let text: string
  try {
    // 优先调用后端获取完整错误报告（含内存收集 + 日志扫描 + 系统信息）
    text = await api.getErrorLogText()
    // 在报告末尾追加当前对话上下文的错误信息，便于定位
    if (props.error || props.errorTraceId) {
      text += '\n\n--- 当前对话错误上下文 ---\n'
      if (props.errorCategory) text += `错误类别: ${props.errorCategory}\n`
      if (props.errorTraceId) text += `Trace ID: ${props.errorTraceId}\n`
      if (props.error) text += `错误信息: ${props.error}\n`
    }
  } catch {
    // 后端不可用时降级为本地拼接
    const now = new Date()
    const ts = now.toISOString().replace('T', ' ').substring(0, 19)
    const lines = [
      'Maxma 暂时连接不上',
      '========================================',
      `时间: ${ts}`,
      `Trace ID: ${props.errorTraceId || 'N/A'}`,
      `错误类别: ${props.errorCategory || 'system_error'}`,
      `错误信息: ${props.error || 'N/A'}`,
      '========================================',
    ]
    text = lines.join('\n')
  }
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 降级：用临时 textarea
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  copySuccess.value = true
  setTimeout(() => { copySuccess.value = false }, 2000)
}

const emit = defineEmits<{
  (e: 'action', p: { action: string; data?: unknown }): void
  (e: 'cite', ref: ParsedRef): void
  (e: 'togglePrivate'): void
  (e: 'planRespond', planId: string, action: 'approve' | 'modify' | 'reject', modifiedPlan?: string): void
  (e: 'pin', payload: { type: 'code' | 'table' | 'summary'; title: string; content: string; sourceTool?: string }): void
}>()

function forwardAction(payload: { action: string; data?: unknown }) {
  emit('action', payload)
}

function onPlanRespond(planId: string, action: 'approve' | 'modify' | 'reject', modifiedPlan?: string) {
  emit('planRespond', planId, action, modifiedPlan)
}

const windowRef = ref<HTMLElement | null>(null)
// DynamicScroller 组件实例引用，用于调用 scrollToBottom/scrollToItem/scrollToPosition
const scrollerRef = ref<{
  scrollToBottom: () => void
  scrollToItem: (index: number, options?: { align?: string; smooth?: boolean; offset?: number }) => void
  scrollToPosition: (position: number, options?: { align?: string; smooth?: boolean; offset?: number }) => void
} | null>(null)
const SCROLL_BOTTOM_THRESHOLD = 100
// 通过 @scroll 事件维护 "是否接近底部" 的响应式状态，替代原先直接读取 windowRef.scrollTop
const isNearBottomRef = ref(true)
const typingDelayElapsed = ref(false)
let typingTimer: ReturnType<typeof setTimeout> | null = null

const currentTurnHasVisibleActivity = computed(() => {
  const turn = props.currentTurn
  if (!turn) return false
  if (turn.finalAnswer) return true
  return turn.events.some(ev => ev.kind === 'tool' || (ev.kind === 'thinking' && !ev.consumed))
})

const showTypingIndicator = computed(() =>
  Boolean(props.currentTurn) && typingDelayElapsed.value && !currentTurnHasVisibleActivity.value
)

const showSkeleton = computed(() =>
  Boolean(props.currentTurn) && !currentTurnHasVisibleActivity.value
)

/** DynamicScroller 根元素的 scroll 事件：维护 isNearBottomRef 状态。
 *  Vue 3 中组件未声明的 @scroll 会透传到根 DOM 元素作为原生监听器。 */
function onScrollerScroll(e: Event) {
  const el = e.target as HTMLElement
  if (!el) return
  isNearBottomRef.value =
    el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD
}

function isNearBottom(): boolean {
  return isNearBottomRef.value
}

function hasAnswerBlock(turn: ChatTurn): boolean {
  return turn.events.some(e => e.kind === 'thinking' && e.becameAnswer)
}

/** 合并已完成轮次和当前流式轮次到单个列表，用 turn.id 作为 key，
 *  使组件实例在过渡时不被销毁重建 */
const mergedTurns = computed<ChatTurn[]>(() => {
  if (!props.currentTurn) return props.turns
  // currentTurn 可能已被 pushed 到 turns（becameAnswer 分支），去重
  if (props.turns.some(t => t.id === props.currentTurn!.id)) return props.turns
  return [...props.turns, props.currentTurn]
})

/** mergedTurns 中第 mergedIdx 项在 props.turns 中的索引（当前轮返回 -1） */
function turnsIndex(mergedIdx: number): number {
  // 前 props.turns.length 项索引与 mergedIdx 一致
  if (mergedIdx < props.turns.length) return mergedIdx
  return -1
}

/** 该轮次是否正在流式生成中 */
function isStreamingTurn(turn: ChatTurn): boolean {
  return props.currentTurn?.id === turn.id
}

watch(
  () => props.currentTurn?.id,
  (id) => {
    if (typingTimer) {
      clearTimeout(typingTimer)
      typingTimer = null
    }
    typingDelayElapsed.value = false
    if (!id) return
    const delay = 1500 + Math.floor(Math.random() * 2000)
    typingTimer = setTimeout(() => {
      if (props.currentTurn?.id === id) {
        typingDelayElapsed.value = true
      }
    }, delay)
  },
  { immediate: true }
)

function scrollToBottom() {
  nextTick(() => {
    scrollerRef.value?.scrollToBottom()
  })
}

watch(
  () => props.sessionId,
  (sessionId, previousSessionId) => {
    // 保存上一个会话的滚动位置（用 onScrollerScroll 维护的 isNearBottomRef 推断 scrollTop）
    if (previousSessionId) {
      // 读取 DynamicScroller 根 DOM 元素的 scrollTop 用于持久化
      const scrollerEl = (scrollerRef.value as unknown as { $el?: HTMLElement } | null)?.$el
      if (scrollerEl) {
        chatSessionAliveCache.rememberScroll(previousSessionId, scrollerEl.scrollTop)
      }
    }
    if (!sessionId) return
    nextTick(() => {
      const savedScrollTop = chatSessionAliveCache.restoreScroll(sessionId)
      if (savedScrollTop != null && savedScrollTop > 0) {
        scrollerRef.value?.scrollToPosition(savedScrollTop)
      } else {
        scrollerRef.value?.scrollToBottom()
      }
    })
  },
  { immediate: true },
)

function scrollToTurn(index: number) {
  // scroll-marks 的 index 是 props.turns 中的索引，
  // 由于 mergedTurns 前 props.turns.length 项与 props.turns 一一对应，
  // 可直接将 index 作为 DynamicScroller 的 item index 调用 scrollToItem
  scrollerRef.value?.scrollToItem(index, { align: 'start', smooth: true })
}

watch(() => props.turns.length, () => {
  if (isNearBottom()) scrollToBottom()
})
watch(
  () => props.currentTurn?.events.length,
  () => {
    if (isNearBottom()) scrollToBottom()
  }
)
watch(
  () => props.currentTurn?.finalAnswer,
  () => {
    if (isNearBottom()) scrollToBottom()
  }
)

// ── Typewriter: 调皮互动文案轮播 ──
const words = [
  '想我了没宝宝',
  '我厉害不',
  '今天想聊什么呀',
  '快夸我快夸我',
  '你是不是又想我了',
  '来找我玩啦',
  '等你好久啦',
  '有什么好玩的事吗',
  '小猪猪在干嘛呢',
  '嘿嘿嘿'
]
const displayedWord = ref(words[0])
let wordIndex = 0
let charIndex = words[0].length
let isDeleting = false
let typeTimer: ReturnType<typeof setTimeout> | null = null

function typewriterTick() {
  const current = words[wordIndex]
  if (!isDeleting) {
    if (charIndex < current.length) {
      charIndex++
      displayedWord.value = current.slice(0, charIndex) + (charIndex === current.length ? '.' : '')
      typeTimer = setTimeout(typewriterTick, 120)
    } else {
      // 打出完整词后暂停 1.5s 再开始删除
      isDeleting = true
      typeTimer = setTimeout(typewriterTick, 1500)
    }
  } else {
    if (charIndex > 0) {
      charIndex--
      displayedWord.value = current.slice(0, charIndex)
      typeTimer = setTimeout(typewriterTick, 80)
    } else {
      isDeleting = false
      wordIndex = (wordIndex + 1) % words.length
      charIndex = 0
      typeTimer = setTimeout(typewriterTick, 120)
    }
  }
}

// ── Private mode toggle (Ctrl+K) ──
function togglePrivate() {
  emit('togglePrivate')
}

function onPrivateKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    togglePrivate()
  }
}

onMounted(() => {
  displayedWord.value = words[0]
  charIndex = words[0].length
  wordIndex = 0
  isDeleting = false
  typewriterTick()
  document.addEventListener('keydown', onPrivateKeydown)
})

onUnmounted(() => {
  if (props.sessionId) {
    // 读取 DynamicScroller 根 DOM 元素的 scrollTop 用于持久化
    const scrollerEl = (scrollerRef.value as unknown as { $el?: HTMLElement } | null)?.$el
    if (scrollerEl) {
      chatSessionAliveCache.rememberScroll(props.sessionId, scrollerEl.scrollTop)
    }
  }
  if (typeTimer) clearTimeout(typeTimer)
  if (typingTimer) clearTimeout(typingTimer)
  document.removeEventListener('keydown', onPrivateKeydown)
})

// === 引用功能 ===

const MAX_CITE_LENGTH = 1000

const ctxMenuVisible = ref(false)
const ctxMenuPos = ref({ x: 0, y: 0 })
const pendingCitation = ref<{ text: string } | null>(null)

/** 右键点击的用户消息在 turns 中的索引（-1 表示当前正在生成的 turn） */
const pendingUserMsgIdx = ref<number | null>(null)

const ctxMenuItems = computed((): ContextMenuItem[] => {
  const items: ContextMenuItem[] = [
    { label: '引用', action: 'cite', icon: 'cite-speech' },
    { label: '复制', action: 'copy', icon: 'copy' },
  ]
  // 仅在右键最后一条已完成用户消息时显示「撤回」
  if (
    pendingUserMsgIdx.value !== null
    && pendingUserMsgIdx.value === props.turns.length - 1
    && props.turns.length > 0
  ) {
    items.push({ label: '撤回', action: 'undo', icon: 'undo-arrow' })
  }
  return items
})

function onBubbleContextMenu(
  event: MouseEvent,
  _sourceType: string,
  fullText: string,
  _sourceLabel: string,
  userMsgIdx?: number,
) {
  pendingUserMsgIdx.value = userMsgIdx ?? null

  let citeText = fullText

  // 检查是否有文本选中
  const selection = window.getSelection()
  const selectedText = selection?.toString().trim()
  if (selectedText && selection!.rangeCount > 0) {
    const range = selection!.getRangeAt(0)
    const target = event.currentTarget as HTMLElement | null
    if (target && target.contains(range.commonAncestorContainer)) {
      citeText = selectedText
    }
    selection!.removeAllRanges()
  }

  if (!citeText) return

  if (citeText.length > MAX_CITE_LENGTH) {
    citeText = citeText.slice(0, MAX_CITE_LENGTH) + '…'
  }

  pendingCitation.value = { text: citeText }
  ctxMenuPos.value = { x: event.clientX, y: event.clientY }
  ctxMenuVisible.value = true
}

function handleContextMenuSelect(action: string) {
  if (action === 'cite' && pendingCitation.value) {
    const label = pendingCitation.value.text.length > 80
      ? pendingCitation.value.text.slice(0, 80) + '…'
      : pendingCitation.value.text
    const citeRef: ParsedRef = { type: 'cite', text: pendingCitation.value.text, label }
    emit('cite', citeRef)
  } else if (action === 'copy' && pendingCitation.value) {
    navigator.clipboard.writeText(pendingCitation.value.text)
  } else if (action === 'undo') {
    emit('action', { action: 'undo', data: { n: 1 } })
  }
  closeContextMenu()
}

function closeContextMenu() {
  ctxMenuVisible.value = false
  pendingCitation.value = null
  pendingUserMsgIdx.value = null
}
</script>

<style scoped>
.chat-window {
	  flex: 1;
	  /* overflow-y 移除：DynamicScroller 自身是滚动容器 */
	  padding: 20px 24px;
	  background: var(--bg-primary);
	  display: flex;
	  flex-direction: column;
	}
/* DynamicScroller 根元素：作为滚动容器 */
.messages-list {
  flex: 1;
  max-width: 768px;
  width: 100%;
  margin: 0 auto;
}
/* 每个轮次的用户消息和助手回复：包在 turn-wrapper 中以维持 gap */
.turn-wrapper {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 6px;  /* 维持轮次之间的间距 */
}
.empty-state {
  height: 100%;
}
.cite-source {
  /* 包装层，不引入额外布局影响 */
}
.empty-reply-placeholder {
  opacity: 0.7;
}
.system-event-bubble {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  margin: 2px 0;
  border-left: 2px solid var(--border);
  background: transparent;
  background: transparent;
  background: color-mix(in srgb, var(--bg-secondary) 60%, transparent);
  border-radius: 4px;
  font-size: 0.82em;
  color: var(--text-secondary);
}
.system-event-icon {
  flex-shrink: 0;
  opacity: 0.6;
}
.system-event-text {
  line-height: 1.5;
}
.empty-state {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  height: 100%;
  padding: 0 48px 40px 48px;
  gap: 16px;
  background-image: var(--empty-bg-image, url('@/assets/images/brand/empty-bg-day.jpg'));
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  border-radius: 14px;
  overflow: hidden;
}
.empty-state-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, transparent 35%, rgba(255, 255, 255, 0.55) 100%);
  pointer-events: none;
  z-index: 0;
}
.empty-state-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.empty-state-text {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.empty-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 2.8em;
  font-weight: 700;
  font-family: var(--font-display);
  letter-spacing: -0.5px;
  color: var(--accent);
  text-shadow: 0 2px 16px rgba(255, 255, 255, 0.6);
}
.empty-desc {
	  font-size: 1.3em;
	  color: var(--accent);
	  font-weight: 500;
	  text-shadow: 0 1px 12px rgba(255, 255, 255, 0.6);
	}
.typewriter {
  display: inline-block;
  min-width: 1ch;
}
.typewriter-cursor {
  display: inline-block;
  margin-left: 1px;
  font-weight: 300;
  color: var(--text-secondary);
  animation: blink 0.7s step-end infinite;
}
@keyframes blink {
  50% { opacity: 0; }
}

/* ── Quick hints (from variant D) ── */
.quick-hints {
  display: flex;
  flex-direction: column;
  gap: 10px;
  opacity: .65;
  transition: opacity .2s;
  text-shadow: 0 1px 8px rgba(255, 255, 255, 0.5);
}
.quick-hints:hover {
  opacity: .9;
}
.quick-hint {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9em;
  color: var(--text-secondary);
  line-height: 1.5;
  cursor: default;
  transition: color .15s;
}
.quick-hint kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 5px;
  font-size: 0.75em;
  font-family: inherit;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
  box-shadow: 0 1px 0 var(--border);
}
.quick-hint-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: var(--text-secondary);
  flex-shrink: 0;
}
.quick-hint:hover {
  color: var(--accent);
  cursor: pointer;
}
.error-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-radius: var(--radius);
  font-size: 0.9em;
  margin: 8px 0;
}
.error-icon {
  flex-shrink: 0;
  font-size: 1em;
}
.error-message {
  flex: 1;
}
.error-trace-id {
  font-size: 0.75em;
  opacity: 0.7;
  font-family: monospace;
}
.error-copy-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid currentColor;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s, background 0.15s;
  font-size: 0.8em;
  padding: 0;
}
.error-copy-btn:hover {
  opacity: 1;
  background: transparent;
  background: transparent;
  background: color-mix(in srgb, currentColor 10%, transparent);
}
.error-copy-btn .copy-icon {
  display: inline-block;
  width: 12px;
  height: 12px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='9' y='9' width='13' height='13' rx='2' ry='2'%3E%3C/rect%3E%3Cpath d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'%3E%3C/path%3E%3C/svg%3E");
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
}
.error-copy-btn .copy-success {
	  color: var(--status-ok);
	  font-weight: bold;
	}
/* 用户错误：暖琥珀警告 */
.error-banner.error-user_error {
	  background: var(--bg-card);
	  background: color-mix(in srgb, var(--status-warn) 10%, var(--bg-card));
	  border: 1px solid transparent;
	  border: 1px solid color-mix(in srgb, var(--status-warn) 30%, transparent);
	  color: var(--status-warn);
	}
	/* 工具错误：暖琥珀 */
	.error-banner.error-tool_error {
	  background: var(--bg-card);
	  background: color-mix(in srgb, var(--status-warn) 10%, var(--bg-card));
	  border: 1px solid transparent;
	  border: 1px solid color-mix(in srgb, var(--status-warn) 30%, transparent);
	  color: var(--status-warn);
	}
	/* 系统错误：暖红 */
	.error-banner.error-system_error {
	  background: var(--bg-card);
	  background: color-mix(in srgb, var(--status-error) 10%, var(--bg-card));
	  border: 1px solid transparent;
	  border: 1px solid color-mix(in srgb, var(--status-error) 25%, transparent);
	  color: var(--status-error);
	}
	/* 限流错误：暖蓝 */
	.error-banner.error-rate_limit {
	  background: var(--bg-card);
	  background: color-mix(in srgb, var(--status-info) 10%, var(--bg-card));
	  border: 1px solid transparent;
	  border: 1px solid color-mix(in srgb, var(--status-info) 25%, transparent);
	  color: var(--status-info);
	}
/* 取消：灰色 */
.error-banner.error-cancelled {
  background: var(--bg-card);
  background: color-mix(in srgb, var(--text-secondary) 8%, var(--bg-card));
  border: 1px solid var(--border);
  color: var(--text-secondary);
}
/* 默认/系统错误 */
.error-banner.error-system {
  background: var(--bg-card);
  background: color-mix(in srgb, var(--status-error) 10%, var(--bg-card));
  border: 1px solid transparent;
  border: 1px solid color-mix(in srgb, var(--status-error) 25%, transparent);
  color: var(--status-error);
}

/* ── 右侧滚动标记 ── */
.scroll-marks {
  --item-gap: 18px;

  position: fixed;
  right: max(12px, calc((100vw - 1036px) / 4 + 12px));
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--item-gap);
  z-index: 100;
  pointer-events: none;
}

.scroll-mark {
  position: relative;
  width: 18px;
  height: 4px;
  border-radius: 2px;
  background: var(--border);
  cursor: pointer;
  pointer-events: auto;
  transition: background 0.15s, width 0.15s;
  flex-shrink: 0;
}

/* 不可见的悬停/点击判定区，以横条为中心上下各延展 gap/2 */
.scroll-mark::before {
  content: '';
  position: absolute;
  left: -12px;
  right: -12px;
  top: calc(var(--item-gap) / -2);
  bottom: calc(var(--item-gap) / -2);
}

.scroll-mark:hover {
  background: var(--accent);
  width: 24px;
}

.scroll-mark:active {
  background: var(--accent-dark);
}

/* ── 助手侧容器：默认隐藏记忆日志，hover 整个区域才显示 ── */
.assistant-side .memory-tool-log {
  opacity: 0;
  transition: opacity 0.15s ease;
}

.assistant-side:hover .memory-tool-log {
  opacity: 1;
}

/* ── 后台记忆更新日志 ── */
.memory-tool-log {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 0 4px 0;
  margin-top: 0;
}

.memory-tool-entry {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.75em;
  color: var(--text-secondary);
  line-height: 1.4;
  opacity: 0.7;
  transition: opacity 0.15s;
}

.memory-tool-entry:hover {
  opacity: 1;
}

.memory-tool-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  font-size: 9px;
}

.memory-spinner {
  display: inline-block;
  width: 8px;
  height: 8px;
  border: 1.5px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: memory-spin 0.6s linear infinite;
}

@keyframes memory-spin {
  to { transform: rotate(360deg); }
}

.memory-check {
	  color: var(--status-ok);
	}
	
	.memory-cross {
	  color: var(--status-error);
	}

.memory-tool-name {
  font-weight: 500;
  color: var(--text-secondary);
}

.memory-tool-status {
  font-style: italic;
  color: var(--text-tertiary);
}

.memory-tool-status.is-error {
	  color: var(--status-error);
	}

.memory-tool-output {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-tertiary);
  cursor: default;
}

.memory-tool-elapsed {
  font-variant-numeric: tabular-nums;
  opacity: 0.6;
  font-size: 0.7em;
}

/* ── 流式输出打字指示器 ── */
.typing-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 16px;
  margin: 8px 0;
  color: var(--text-secondary);
  font-size: 0.86em;
}

.typing-label {
  margin-right: 4px;
}

.typing-dots {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.typing-dot {
	  width: 8px;
	  height: 8px;
	  border-radius: 50%;
	  background: var(--accent);
	  animation: typingBounce 1.4s infinite ease-in-out both;
	}

.typing-dots .typing-dot:nth-child(1) {
  animation-delay: -0.32s;
}

.typing-dots .typing-dot:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes typingBounce {
  0%, 80%, 100% {
    transform: scale(0.6);
    opacity: 0.5;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

/* ── 骨架屏：AI 回复加载占位 ── */
.message-skeleton {
  display: flex;
  gap: 12px;
  padding: 12px 24px;
  align-items: flex-start;
}
.skeleton-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--bg-card);
  flex-shrink: 0;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}
.skeleton-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
}
.skeleton-line {
  height: 12px;
  border-radius: 6px;
  background: var(--bg-card);
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}
.skeleton-line--1 { width: 85%; }
.skeleton-line--2 { width: 65%; }
.skeleton-line--3 { width: 40%; }

@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}

/* ── 空状态文字浮动动画 ── */
.empty-desc {
  animation: empty-float 3s ease-in-out infinite;
}
@keyframes empty-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}

@media (prefers-reduced-motion: reduce) {
  .typewriter-cursor,
  .memory-spinner,
  .typing-dot,
  .message-skeleton * {
    animation: none;
  }
  .empty-desc {
    animation: none;
  }

  .quick-hints,
  .scroll-mark,
  .assistant-side .memory-tool-log,
  .memory-tool-entry {
    transition: none;
  }
}
</style>
