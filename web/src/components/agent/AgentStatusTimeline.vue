<template>
  <div class="agent-timeline" ref="timelineEl">
    <header class="timeline-header">
      <h3 class="timeline-title">执行时间线</h3>
      <div class="timeline-controls" role="group" aria-label="时间线过滤">
        <button
          type="button"
          class="filter-btn"
          :class="{ active: filter === 'all' }"
          :aria-pressed="filter === 'all'"
          @click="filter = 'all'"
        >
          全部
        </button>
        <button
          type="button"
          class="filter-btn"
          :class="{ active: filter === 'running' }"
          :aria-pressed="filter === 'running'"
          @click="filter = 'running'"
        >
          进行中
        </button>
        <button
          type="button"
          class="filter-btn"
          :class="{ active: filter === 'completed' }"
          :aria-pressed="filter === 'completed'"
          @click="filter = 'completed'"
        >
          已完成
        </button>
      </div>
    </header>

    <div class="timeline-content" :class="{ 'is-empty': filteredEvents.length === 0 }">
      <TransitionGroup name="timeline-event" tag="div" class="timeline-events">
        <div
          v-for="event in filteredEvents"
          :key="event.id"
          class="timeline-event-item"
          :class="[`type-${event.type}`, `status-${event.status}`]"
        >
          <!-- 时间轴点 -->
          <div class="event-dot-wrapper">
            <div class="event-dot">
              <Icon v-if="event.status === 'succeeded'" name="checkmark" :size="12" />
              <Icon v-else-if="event.status === 'failed'" name="close" :size="12" />
              <span v-else-if="event.status === 'running'" class="dot-spinner">◉</span>
              <span v-else>○</span>
            </div>
          </div>

          <!-- 事件内容 -->
          <div class="event-content">
            <div class="event-header">
              <span class="event-title">{{ event.title }}</span>
              <span class="event-time">{{ formatTime(event.timestamp) }}</span>
            </div>

            <p v-if="event.description" class="event-description">
              {{ event.description }}
            </p>

            <div v-if="event.metadata" class="event-metadata">
              <span
                v-for="(value, key) in event.metadata"
                :key="key"
                class="metadata-tag"
              >
                <strong>{{ key }}:</strong> {{ value }}
              </span>
            </div>

            <!-- 事件操作 -->
            <div v-if="event.actions && event.actions.length > 0" class="event-actions">
              <button
                v-for="action in event.actions"
                :key="action.label"
                type="button"
                class="event-action-btn"
                @click="handleAction(event.id, action.type)"
              >
                {{ action.label }}
              </button>
            </div>

            <!-- 持续时间指示 -->
            <div v-if="event.duration" class="event-duration">
              <Icon name="clock" :size="12" />
              <span>{{ formatDuration(event.duration) }}</span>
            </div>
          </div>
        </div>
      </TransitionGroup>

      <!-- 空状态 -->
      <div v-if="filteredEvents.length === 0" class="timeline-empty">
        <div class="empty-icon">📋</div>
        <p>{{ emptyMessage }}</p>
      </div>

      <!-- 实时更新指示 -->
      <div v-if="isLive && hasRunningEvents" class="live-indicator">
        <div class="live-dot"></div>
        <span>实时更新中</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { gsap, useGsap, easeMap } from '@/composables/useGsap'
import Icon from '@/components/Icon.vue'
import type { TimelineEvent } from '@/types/agent'

const props = withDefaults(
  defineProps<{
    events: TimelineEvent[]
    isLive?: boolean
  }>(),
  {
    isLive: false,
  }
)

const emit = defineEmits<{
  action: [eventId: string, actionType: string]
}>()

const timelineEl = ref<HTMLElement | null>(null)
/**
 * 相对时间的基准。没有这个 tick 的话，轮询停止后（全终态）
 * 「刚刚 / 3 分钟前」会永久冻结在最后一次数据变化时的值。
 */
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  clock = setInterval(() => {
    now.value = Date.now()
  }, 60_000)
})
onUnmounted(() => {
  if (clock) {
    clearInterval(clock)
    clock = null
  }
})
const filter = ref<'all' | 'running' | 'completed'>('all')

const filteredEvents = computed(() => {
  let filtered = props.events

  if (filter.value === 'running') {
    filtered = filtered.filter(e => e.status === 'running' || e.status === 'queued')
  } else if (filter.value === 'completed') {
    filtered = filtered.filter(
      e => e.status === 'succeeded' || e.status === 'failed' || e.status === 'cancelled'
    )
  }

  // 按时间倒序排列（最新的在上面）
  return [...filtered].sort((a, b) => b.timestamp - a.timestamp)
})

const hasRunningEvents = computed(() =>
  props.events.some(e => e.status === 'running')
)

const emptyMessage = computed(() => {
  if (filter.value === 'running') return '当前没有正在执行的任务'
  if (filter.value === 'completed') return '还没有完成的任务'
  return '时间线为空'
})

function formatTime(timestamp: number): string {
  const diff = now.value - timestamp

  if (diff < 60000) {
    return '刚刚'
  } else if (diff < 3600000) {
    return `${Math.floor(diff / 60000)} 分钟前`
  } else if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)} 小时前`
  } else {
    const date = new Date(timestamp)
    return date.toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}分${remainingSeconds}秒`
}

function handleAction(eventId: string, actionType: string) {
  emit('action', eventId, actionType)
}

// 新事件入场动画
//
// 注意：这里用 Vue 的 `watch` + `contextSafe`，而不是 GSAP context 的方法——
// GSAP 3.15 的 context 并没有 `watchDeep`（那是别的库的 API），调用会直接抛
// `ctx.watchDeep is not a function` 让整个组件挂掉。仓库既有做法（见
// AgentCard / BubbleChrome）一律是 `watch(..., contextSafe(...))`。
useGsap((_ctx, contextSafe) => {
  watch(
    // 监听「事件内容」而不只是数组长度：长度不变但某条事件的状态从
    // running 翻成 succeeded 时，之前完全不触发动画。
    () => props.events.map(e => `${e.id}:${e.status}`).join('|'),
    contextSafe(() => {
      const items = timelineEl.value?.querySelectorAll('.timeline-event-item')
      if (!items || items.length === 0) return

      // 只对第一个元素（最新事件）做动画
      const latestItem = items[0]
      gsap.fromTo(
        latestItem,
        { opacity: 0, x: -20, scale: 0.95 },
        { opacity: 1, x: 0, scale: 1, duration: 0.4, ease: easeMap.out }
      )
    }),
    // flush: 'post' —— 默认的 pre 时机下 DOM 还没更新，拿到的是旧列表。
    { flush: 'post' }
  )
})
</script>

<style scoped>
.agent-timeline {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 800px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

/* 时间线头部 */
.timeline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-primary);
}

.timeline-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.timeline-controls {
  display: flex;
  gap: 6px;
}

.filter-btn {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.filter-btn:hover {
  background: var(--bg-hover);
  border-color: var(--text-secondary);
}

.filter-btn.active {
  background: var(--accent-solid);
  border-color: var(--accent-solid);
  color: var(--accent-solid-text);
}

/* 时间线内容 */
.timeline-content {
  position: relative;
  padding: 20px;
  max-height: 600px;
  overflow-y: auto;
}

.timeline-content.is-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
}

.timeline-events {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 时间线事件 */
.timeline-event-item {
  position: relative;
  display: flex;
  gap: 16px;
  padding-left: 8px;
}

.timeline-event-item::before {
  content: '';
  position: absolute;
  left: 19px;
  top: 40px;
  bottom: -20px;
  width: 2px;
  background: var(--border);
}

.timeline-event-item:last-child::before {
  display: none;
}

/* 时间轴点 */
.event-dot-wrapper {
  position: relative;
  flex-shrink: 0;
  padding-top: 4px;
}

.event-dot {
  position: relative;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--bg-primary);
  border: 2px solid var(--border);
  color: var(--text-secondary);
  font-size: 14px;
  z-index: 1;
}

.status-running .event-dot {
  border-color: var(--accent);
  color: var(--accent-text);
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-primary));
}

.status-succeeded .event-dot {
  border-color: var(--status-ok);
  color: var(--status-ok-text);
  background: color-mix(in srgb, var(--status-ok) 10%, var(--bg-primary));
}

.status-failed .event-dot {
  border-color: var(--status-error);
  color: var(--status-error-text);
  background: color-mix(in srgb, var(--status-error) 10%, var(--bg-primary));
}

.dot-spinner {
  animation: rotate 2s linear infinite;
}

@keyframes rotate {
  to { transform: rotate(360deg); }
}

/* 事件内容 */
.event-content {
  flex: 1;
  min-width: 0;
}

.event-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.event-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.event-time {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
}

.event-description {
  margin: 0 0 8px 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.event-metadata {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.metadata-tag {
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 11px;
}

.metadata-tag strong {
  color: var(--text-primary);
}

.event-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.event-action-btn {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.event-action-btn:hover {
  background: var(--accent-solid);
  border-color: var(--accent-solid);
  color: var(--accent-solid-text);
}

.event-duration {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  color: var(--text-tertiary);
  font-size: 11px;
}

/* 空状态 */
.timeline-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 40px 20px;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
  opacity: 0.4;
}

.timeline-empty p {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
}

/* 实时更新指示 */
.live-indicator {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  margin: 20px -20px -20px -20px;
  background: var(--bg-card);
  border-top: 1px solid var(--border);
  font-size: 12px;
  font-weight: 500;
  color: var(--accent-text);
}

.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-text);
  animation: pulse-dot 2s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(0.8);
  }
}

/* 事件过渡动画 */
.timeline-event-move,
.timeline-event-enter-active,
.timeline-event-leave-active {
  transition: all 0.4s var(--ease-out);
}

.timeline-event-enter-from {
  opacity: 0;
  transform: translateX(-20px) scale(0.95);
}

.timeline-event-leave-to {
  opacity: 0;
  transform: translateX(20px) scale(0.95);
}

.timeline-event-leave-active {
  position: absolute;
}

/* 响应式 */
@media (max-width: 600px) {
  .timeline-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .timeline-controls {
    width: 100%;
    justify-content: flex-end;
  }

  .event-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
}

/* 减少动画 */
@media (prefers-reduced-motion: reduce) {
  .timeline-event-move,
  .timeline-event-enter-active,
  .timeline-event-leave-active,
  .filter-btn,
  .event-action-btn {
    transition: none;
  }

  .dot-spinner,
  .live-dot {
    animation: none;
  }
}
</style>
