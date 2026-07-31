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
            streamingTokensSignature(turn),
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
                    :responded="ev.interaction?.responded ?? null"
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
                  <Icon class="system-event-icon" name="info" :size="14" />
                  <span class="system-event-text">{{ ev.content }}</span>
                </div>
              </template>
              <!-- finalAnswer：仅在已完成（非流式）轮次中展示 -->
              <div
                v-if="turn.finalAnswer && !hasAnswerBlock(turn) && !isStreamingTurn(turn)"
                class="cite-source"
                @contextmenu.prevent="onBubbleContextMenu($event, 'assistant_message', turn.finalAnswer, 'AI')"
              >
                <MessageBubble
                  role="assistant"
                  :content="turn.finalAnswer"
                  :sticker-url="turn.stickerUrl"
                />
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
                    <Icon v-else-if="me.status === 'done'" class="memory-check" name="checkmark" :size="12" />
                    <Icon v-else class="memory-cross" name="close" :size="12" />
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
          <Icon class="error-icon" :name="errorIconName" :size="16" />
          <span class="error-message">{{ error }}</span>
          <span v-if="errorTraceId" class="error-trace-id">Trace: {{ errorTraceId }}</span>
          <button class="error-copy-btn" @click="copyErrorLog" :title="'复制错误日志'" aria-label="复制错误日志">
            <Icon v-if="copySuccess" class="copy-success" name="checkmark" :size="14" />
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
              <p class="empty-title">Maxma</p>
              <p class="empty-desc">
                <span class="typewriter">{{ displayedWord }}<span class="typewriter-cursor">|</span></span>
              </p>
            </div>
            <div class="quick-hints" data-qh>
              <span class="quick-hint">
                <span class="quick-hint-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg></span>
                单击开关侧栏
              </span>
              <span class="quick-hint">
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
      <button
        v-for="(turn, idx) in turns"
        :key="turn.id"
        type="button"
        class="scroll-mark"
        @click="scrollToTurn(idx)"
        @keydown.enter.prevent="scrollToTurn(idx)"
        @keydown.space.prevent="scrollToTurn(idx)"
        :title="turn.userMessage.slice(0, 60)"
        aria-label="跳转到该轮次"
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
import { computed, nextTick, onUnmounted, ref, toRef, watch } from 'vue'
import { useTheme } from '@/composables/useTheme'
import { useChatScroll } from '@/composables/useChatScroll'
import { gsap, useGsap } from '@/composables/useGsap'
import { useTypewriter } from '@/composables/useTypewriter'
import { useContextMenu } from '@/composables/useContextMenu'
import ContextMenu from './ContextMenu.vue'
import MessageBubble from './MessageBubble.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import ToolBubbleRouter from './ToolBubbleRouter.vue'
import PlanCard from './PlanCard.vue'
import ApprovalBubble from './ApprovalBubble.vue'
import SubAgentCard from './SubAgentCard.vue'
import { toolDisplayName } from './tools/_shared/displayNames'
import emptyBgDay from '@/assets/images/brand/empty-bg-day.jpg'
import emptyBgNight from '@/assets/images/brand/empty-bg-night.jpg'
// 虚拟列表：仅渲染视口内/附近的轮次，长对话性能大幅提升
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import Icon from './Icon.vue'

const props = withDefaults(defineProps<{
  sessionId: string
  turns?: ChatTurn[]
  currentTurn?: ChatTurn | null
  error?: string | null
  errorCategory?: 'user_error' | 'tool_error' | 'system_error' | 'rate_limit' | 'cancelled' | null
  errorTraceId?: string | null
}>(), {
  turns: () => [],
  currentTurn: null,
  error: null,
  errorCategory: null,
  errorTraceId: null,
})

const emit = defineEmits<{
  (e: 'action', p: { action: string; data?: unknown }): void
  (e: 'cite', ref: ParsedRef): void
  (e: 'togglePrivate'): void
  (e: 'planRespond', planId: string, action: 'approve' | 'modify' | 'reject', modifiedPlan?: string): void
  (e: 'pin', payload: { type: 'code' | 'table' | 'summary'; title: string; content: string; sourceTool?: string }): void
}>()

// ── Composables ──

const {
  scrollerRef,
  onScrollerScroll,
  scrollToTurn,
  streamingTokensSignature,
} = useChatScroll({
  sessionId: toRef(props, 'sessionId'),
  turns: toRef(props, 'turns'),
  currentTurn: toRef(props, 'currentTurn'),
})

const { displayedWord } = useTypewriter()

const {
  ctxMenuVisible,
  ctxMenuPos,
  ctxMenuItems,
  onBubbleContextMenu,
  handleContextMenuSelect,
  closeContextMenu,
} = useContextMenu({
  turns: toRef(props, 'turns'),
  emit,
})

// ── 错误日志一键复制 ──

const { isDark } = useTheme()
const copySuccess = ref(false)

const errorIconName = computed(() => {
  switch (props.errorCategory) {
    case 'user_error': return 'warning'
    case 'tool_error':
    case 'system_error':
      return 'error'
    case 'rate_limit':
    case 'cancelled':
      return 'stop'
    default:
      return 'error'
  }
})

const emptyStateStyle = computed(() => ({
  '--empty-bg-image': `url("${isDark.value ? emptyBgNight : emptyBgDay}")`,
}))

async function copyErrorLog() {
  let text: string
  try {
    text = await api.getErrorLogText()
    if (props.error || props.errorTraceId) {
      text += '\n\n--- 当前对话错误上下文 ---\n'
      if (props.errorCategory) text += `错误类别: ${props.errorCategory}\n`
      if (props.errorTraceId) text += `Trace ID: ${props.errorTraceId}\n`
      if (props.error) text += `错误信息: ${props.error}\n`
    }
  } catch {
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

// ── 事件转发 ──

function forwardAction(payload: { action: string; data?: unknown }) {
  emit('action', payload)
}

function onPlanRespond(planId: string, action: 'approve' | 'modify' | 'reject', modifiedPlan?: string) {
  emit('planRespond', planId, action, modifiedPlan)
}

// ── 轮次列表 ──

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
  Boolean(props.currentTurn) && !currentTurnHasVisibleActivity.value && !typingDelayElapsed.value
)

function hasAnswerBlock(turn: ChatTurn): boolean {
  return turn.events.some(e => e.kind === 'thinking' && e.becameAnswer)
}

/** 合并已完成轮次和当前流式轮次到单个列表 */
const mergedTurns = computed<ChatTurn[]>(() => {
  if (!props.currentTurn) return props.turns
  if (props.turns.some(t => t.id === props.currentTurn!.id)) return props.turns
  return [...props.turns, props.currentTurn]
})

/** mergedTurns 中第 mergedIdx 项在 props.turns 中的索引（当前轮返回 -1） */
function turnsIndex(mergedIdx: number): number {
  if (mergedIdx < props.turns.length) return mergedIdx
  return -1
}

function isStreamingTurn(turn: ChatTurn): boolean {
  return props.currentTurn?.id === turn.id
}

// 打字指示器延迟：新 turn 到达后 1.5-3.5s 才显示 "正在输入"
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

// ── 新消息入场动画（虚拟列表友好：仅对「新增 turn」的 wrapper 做 GSAP from + stagger；
//    会话切换/全量替换时首项 id 变化，历史消息直接显示不做动画） ──
const windowRef = ref<HTMLElement | null>(null)
let lastMergedHeadId: string | undefined
let lastMergedLength = 0

const { contextSafe } = useGsap(() => {
  watch(() => mergedTurns.value.length, contextSafe(async () => {
    const head = mergedTurns.value[0]?.id
    if (head !== lastMergedHeadId) {
      lastMergedHeadId = head
      lastMergedLength = mergedTurns.value.length
      return
    }
    const delta = mergedTurns.value.length - lastMergedLength
    lastMergedLength = mergedTurns.value.length
    if (delta <= 0) return
    await nextTick()
    await new Promise<void>(r => requestAnimationFrame(() => r()))  // 等虚拟列表渲染新项
    const root = windowRef.value
    if (!root) return
    const rows = Array.from(root.querySelectorAll('.turn-wrapper')).slice(-Math.min(delta, 10))
    if (!rows.length) return
    // 3D 立起入场：消息从平面轻微 rotateX 立起 + 弹簧（back.out），方向按角色左右滑入
    gsap.from(rows, {
      autoAlpha: 0,
      x: (_i, el) => (el.classList.contains('user') ? 14 : -14),
      rotationX: -14,
      transformPerspective: 700,
      y: 10,
      duration: 0.42,
      ease: 'back.out(1.4)',
      stagger: 0.045,
      overwrite: 'auto',
    })
  }))
})

onUnmounted(() => {
  if (typingTimer) clearTimeout(typingTimer)
})
</script>

<style scoped>
.chat-window {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    padding: 20px 24px;
    background: var(--bg-primary);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
/* DynamicScroller 根元素：作为滚动容器 */
.messages-list {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  max-width: 768px;
  width: 100%;
  margin: 0 auto;
  overflow-y: auto;
  overflow-x: hidden;
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
  background: color-mix(in srgb, var(--bg-secondary) 60%, transparent);
  border-radius: 4px;
  font-size: 0.82em;
  color: var(--text-secondary);
}
.system-event-icon {
  flex-shrink: 0;
  opacity: 0.6;
  color: var(--text-secondary);
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
  background-image: var(--empty-bg-image);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  border-radius: 14px;
  overflow: hidden;
}
.empty-state-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(to bottom, transparent 35%, color-mix(in srgb, var(--bg-primary) 55%, transparent) 100%);
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
    text-shadow: 0 2px 16px color-mix(in srgb, var(--accent) 15%, transparent);
  }
  .empty-desc {
      font-size: 1.3em;
      color: var(--accent);
      font-weight: 500;
      text-shadow: 0 1px 12px color-mix(in srgb, var(--accent) 15%, transparent);
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
    text-shadow: 0 1px 8px color-mix(in srgb, var(--accent) 12%, transparent);
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
  border: none;
  padding: 0;
  margin: 0;
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
    animation: maxma-bounce-dot 1.4s infinite ease-in-out both;
  }

.typing-dots .typing-dot:nth-child(1) {
  animation-delay: -0.32s;
}

.typing-dots .typing-dot:nth-child(2) {
  animation-delay: -0.16s;
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
