<template>
  <article
    ref="cardEl"
    class="agent-card"
    :class="[`status-${status}`, { 'is-expanded': expanded, 'is-interactive': interactive }]"
    :data-agent-id="agentId"
  >
    <!-- 卡片头部：状态指示器 + 标题 + 操作 -->
    <header
      class="agent-card-header"
      role="button"
      :tabindex="interactive ? 0 : undefined"
      :aria-expanded="interactive ? expanded : undefined"
      @click="interactive && toggle()"
      @keydown="handleHeaderKeydown"
    >
      <div class="status-indicator">
        <div class="status-pulse" v-if="isActive"></div>
        <div class="status-icon" role="img" :aria-label="statusLabel">
          <Icon v-if="status === 'succeeded'" name="checkmark" :size="14" />
          <Icon v-if="status === 'failed'" name="close" :size="14" />
          <span v-if="status === 'queued'" class="status-dot">○</span>
          <span v-if="status === 'running'" class="status-dot running">◉</span>
          <span v-if="status === 'cancelled'" class="status-dot">⊘</span>
        </div>
      </div>

      <div class="agent-meta">
        <h3 class="agent-title">{{ title || `Agent #${agentId.slice(0, 8)}` }}</h3>
        <div class="agent-stats">
          <span class="stat-badge">{{ statusLabel }}</span>
          <span v-if="attempts > 1" class="stat-badge attempts">尝试 {{ attempts }}次</span>
          <span v-if="duration" class="stat-badge duration">{{ formatDuration(duration) }}</span>
        </div>
      </div>

      <div class="agent-actions">
        <button
          v-if="isActive && cancellable"
          type="button"
          class="action-btn cancel-btn"
          :disabled="cancelling"
          @click.stop="handleCancel"
          :aria-label="cancelling ? '取消中' : '取消任务'"
        >
          <Icon name="close" :size="16" />
        </button>
        <button
          v-if="interactive"
          type="button"
          class="action-btn expand-btn"
          :aria-label="expanded ? '收起详情' : '展开详情'"
          :aria-expanded="expanded"
          @click.stop="toggle"
        >
          <span class="expand-icon">{{ expanded ? '⌃' : '⌄' }}</span>
        </button>
      </div>
    </header>

    <!-- 卡片主体：详细信息 -->
    <Transition name="agent-expand">
      <div v-if="expanded" class="agent-card-body">
        <!-- 进度指示 -->
        <div v-if="isActive && progress !== undefined" class="progress-section">
          <div class="progress-bar-wrapper">
            <div class="progress-bar" :style="{ width: `${progress}%` }"></div>
          </div>
          <span class="progress-text">{{ Math.round(progress) }}%</span>
        </div>

        <!-- 任务描述 -->
        <div v-if="description" class="description-section">
          <p class="description-text">{{ description }}</p>
        </div>

        <!-- 执行结果 -->
        <div v-if="status === 'succeeded' && result" class="result-section">
          <h4 class="section-heading">执行结果</h4>
          <div class="result-content">
            <RenderMarkdown :content="result" />
          </div>
        </div>

        <!-- 错误信息 -->
        <div v-if="status === 'failed' && error" class="error-section">
          <h4 class="section-heading">错误信息</h4>
          <pre class="error-content">{{ error }}</pre>
        </div>

        <!-- 取消原因 -->
        <div v-if="status === 'cancelled' && cancelReason" class="cancel-section">
          <p class="cancel-text">{{ formatCancelReason(cancelReason) }}</p>
        </div>

        <!-- 时间线 -->
        <div v-if="timeline && timeline.length > 0" class="timeline-section">
          <h4 class="section-heading">执行时间线</h4>
          <ul class="timeline-list">
            <li v-for="(event, idx) in timeline" :key="idx" class="timeline-item">
              <span class="timeline-time">{{ formatTime(event.timestamp) }}</span>
              <span class="timeline-event">{{ event.message }}</span>
            </li>
          </ul>
        </div>
      </div>
    </Transition>
  </article>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { gsap, useGsap, easeMap } from '@/composables/useGsap'
import Icon from '@/components/Icon.vue'
import RenderMarkdown from '@/components/RenderMarkdown.vue'

export interface AgentCardProps {
  agentId: string
  title?: string
  description?: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  attempts?: number
  duration?: number // 毫秒
  progress?: number // 0-100
  result?: string
  error?: string
  cancelReason?: string
  timeline?: Array<{ timestamp: number; message: string }>
  cancellable?: boolean
  interactive?: boolean
}

const props = withDefaults(defineProps<AgentCardProps>(), {
  attempts: 1,
  cancellable: true,
  interactive: true,
})

const emit = defineEmits<{
  cancel: [agentId: string]
  expand: [agentId: string]
  collapse: [agentId: string]
}>()

const cardEl = ref<HTMLElement | null>(null)
const expanded = ref(false)
const cancelling = ref(false)

/** 取消按钮的复位定时器。组件卸载时必须清掉，否则回调会写已销毁组件的 ref。 */
let cancelResetTimer: ReturnType<typeof setTimeout> | null = null

const isActive = computed(() => props.status === 'queued' || props.status === 'running')

const statusLabel = computed(() => {
  const labels = {
    queued: '等待执行',
    running: '执行中',
    succeeded: '已完成',
    failed: '执行失败',
    cancelled: '已取消',
  }
  return labels[props.status]
})

function toggle() {
  expanded.value = !expanded.value
  if (expanded.value) {
    emit('expand', props.agentId)
  } else {
    emit('collapse', props.agentId)
  }
}

/**
 * 卡片头部是 `role="button"`，内部还有真正的取消/展开按钮。
 * 只处理来自头部自身的事件，避免焦点在内部按钮上按 Enter/Space 时
 * 冒泡到容器、连带把卡片展开。
 */
function handleHeaderKeydown(event: KeyboardEvent) {
  if (!props.interactive) return
  if (event.target !== event.currentTarget) return
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  toggle()
}

async function handleCancel() {
  if (cancelling.value) return
  cancelling.value = true
  emit('cancel', props.agentId)
  // 取消状态由父组件更新props控制
  cancelResetTimer = setTimeout(() => {
    cancelling.value = false
    cancelResetTimer = null
  }, 2000)
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatCancelReason(reason: string): string {
  const reasons: Record<string, string> = {
    cancelled_by_user: '用户手动取消',
    parent_session_closed: '父会话已关闭',
    timeout: '执行超时',
  }
  return reasons[reason] || reason
}

// 卡片入场动画
useGsap(() => {
  if (!cardEl.value) return
  gsap.fromTo(
    cardEl.value,
    { opacity: 0, y: 12, scale: 0.98 },
    { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: easeMap.out }
  )
})

// 状态变化动画
useGsap((_ctx, contextSafe) => {
  watch(() => props.status, contextSafe((newStatus: string, oldStatus: string) => {
    if (!cardEl.value || !oldStatus) return

    // 状态切换时的微动画。
    //
    // 注意 `yoyo` + **偶数** `repeat` 会把补间停在终点值上：GSAP 的
    // yoyo 走「去→回」一轮，repeat:2 即两轮共 4 段，结束时停在「去」的值。
    // 于是 `x:-4, repeat:2` 的失败抖动会让卡片**永久偏移 4px**（实测
    // final x = -4）。所以这里用奇数 repeat（1 / 3）让它回到原位，
    // 并额外用 clearProps 兜底，保证属性不会残留。
    if (newStatus === 'succeeded') {
      gsap.to(cardEl.value, {
        scale: 1.02,
        duration: 0.2,
        yoyo: true,
        repeat: 1,
        ease: 'power2.inOut',
        clearProps: 'scale',
      })
    } else if (newStatus === 'failed') {
      gsap.to(cardEl.value, {
        x: -4,
        duration: 0.1,
        yoyo: true,
        repeat: 3,
        ease: 'power2.inOut',
        clearProps: 'x',
      })
    }
  }))
})

onUnmounted(() => {
  if (cancelResetTimer) {
    clearTimeout(cancelResetTimer)
    cancelResetTimer = null
  }
})
</script>

<style scoped>
.agent-card {
  position: relative;
  margin: 10px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  overflow: hidden;
  transition: all 0.25s var(--ease-out);
}

.agent-card.is-interactive {
  cursor: pointer;
}

.agent-card:hover {
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  box-shadow: 0 2px 12px color-mix(in srgb, var(--accent) 8%, transparent);
}

.agent-card.is-expanded {
  border-color: var(--accent);
}

/* 状态颜色变体 */
.agent-card.status-succeeded {
  border-left: 3px solid var(--status-ok);
}

.agent-card.status-failed {
  border-left: 3px solid var(--status-error);
}

.agent-card.status-running {
  border-left: 3px solid var(--accent);
}

.agent-card.status-cancelled {
  border-left: 3px solid var(--text-tertiary);
}

/* 卡片头部 */
.agent-card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  min-height: 56px;
  transition: background 0.2s ease;
}

.agent-card.is-interactive .agent-card-header:hover {
  background: color-mix(in srgb, var(--accent) 3%, transparent);
}

/* 状态指示器 */
.status-indicator {
  position: relative;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.status-pulse {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--accent) 0%, transparent 70%);
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.95); }
  50% { opacity: 0.8; transform: scale(1.1); }
}

.status-icon {
  position: relative;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--bg-primary);
  border: 2px solid var(--border);
  font-size: 18px;
  transition: all 0.2s ease;
}

.status-succeeded .status-icon {
  border-color: var(--status-ok);
  color: var(--status-ok-text);
  background: color-mix(in srgb, var(--status-ok) 10%, var(--bg-primary));
}

.status-failed .status-icon {
  border-color: var(--status-error);
  color: var(--status-error-text);
  background: color-mix(in srgb, var(--status-error) 10%, var(--bg-primary));
}

.status-running .status-icon {
  border-color: var(--accent);
  color: var(--accent-text);
}

.status-cancelled .status-icon {
  border-color: var(--text-tertiary);
  color: var(--text-tertiary);
}

.status-dot {
  display: inline-block;
  line-height: 1;
}

.status-dot.running {
  animation: rotate 2s linear infinite;
}

@keyframes rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Agent元信息 */
.agent-meta {
  flex: 1;
  min-width: 0;
}

.agent-title {
  margin: 0 0 4px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-stats {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.stat-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.3px;
}

.stat-badge.attempts {
  background: color-mix(in srgb, var(--accent) 15%, var(--bg-secondary));
  color: var(--accent-text);
}

.stat-badge.duration {
  font-family: var(--font-mono);
}

/* Agent操作 */
.agent-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.action-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--text-secondary);
  color: var(--text-primary);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cancel-btn:hover:not(:disabled) {
  border-color: var(--status-error);
  color: var(--status-error-text);
}

.expand-icon {
  font-size: 16px;
  transition: transform 0.2s ease;
}

.is-expanded .expand-icon {
  transform: rotate(180deg);
}

/* 卡片主体 */
.agent-card-body {
  padding: 0 16px 16px 16px;
  border-top: 1px solid var(--border);
}

.agent-expand-enter-active,
.agent-expand-leave-active {
  transition: all 0.25s var(--ease-out);
  overflow: hidden;
}

.agent-expand-enter-from,
.agent-expand-leave-to {
  opacity: 0;
  max-height: 0;
}

.agent-expand-enter-to,
.agent-expand-leave-from {
  opacity: 1;
  max-height: 600px;
}

/* 各个区域 */
.progress-section {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0 12px 0;
}

.progress-bar-wrapper {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--bg-secondary);
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 80%, var(--text-primary)));
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.description-section,
.result-section,
.error-section,
.cancel-section,
.timeline-section {
  margin-top: 16px;
}

.section-heading {
  margin: 0 0 8px 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.description-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.result-content {
  padding: 12px;
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.6;
}

.result-content :deep(code) {
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--bg-secondary);
  font-family: var(--font-mono);
  font-size: 12px;
}

.error-content {
  margin: 0;
  padding: 12px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--status-error) 5%, var(--bg-primary));
  border-left: 3px solid var(--status-error);
  color: var(--status-error-text);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.cancel-text {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 13px;
}

/* 时间线 */
.timeline-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.timeline-item {
  display: flex;
  gap: 12px;
  padding: 8px 0;
  border-left: 2px solid var(--border);
  padding-left: 16px;
  position: relative;
}

.timeline-item::before {
  content: '';
  position: absolute;
  left: -5px;
  top: 14px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--bg-card);
}

.timeline-item:last-child {
  border-left-color: transparent;
}

.timeline-time {
  flex-shrink: 0;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--text-tertiary);
}

.timeline-event {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}

/* 响应式 */
@media (max-width: 600px) {
  .agent-card-header {
    padding: 12px;
  }

  .agent-title {
    font-size: 13px;
  }

  .stat-badge {
    font-size: 10px;
    padding: 2px 6px;
  }
}

/* 减少动画 */
@media (prefers-reduced-motion: reduce) {
  .agent-card,
  .action-btn,
  .expand-icon,
  .progress-bar {
    transition: none;
  }

  .status-pulse,
  .status-dot.running {
    animation: none;
  }

  .agent-expand-enter-active,
  .agent-expand-leave-active {
    transition: none;
  }
}
</style>
