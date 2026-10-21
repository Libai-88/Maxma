<template>
  <section ref="cardEl" v-if="available" class="sub-agent-card">
    <button
      class="sub-agent-header"
      type="button"
      :aria-expanded="expanded"
      @click="toggle"
    >
      <div class="header-left">
        <div class="status-indicator">
          <div v-if="hasActiveRuns" class="status-pulse"></div>
          <span class="sub-agent-icon" aria-hidden="true">
            {{ hasActiveRuns ? '◉' : '◌' }}
          </span>
        </div>
        <div class="header-text">
          <span class="sub-agent-title">后台子任务</span>
          <span class="sub-agent-subtitle">{{ runIds.length }} 个子任务</span>
        </div>
      </div>
      <div class="header-right">
        <span v-if="hasActiveRuns" class="active-count-badge">
          {{ activeRunsCount }} 运行中
        </span>
        <span class="sub-agent-toggle" aria-hidden="true">
          {{ expanded ? '⌃' : '⌄' }}
        </span>
      </div>
    </button>

    <Transition name="agent-body">
      <div v-if="expanded" class="sub-agent-body">
        <div v-if="loading" class="sub-agent-loading">
          <div class="loading-spinner"></div>
          <span>正在读取状态…</span>
        </div>
        <template v-else>
          <div v-for="run in visibleRuns" :key="run.run_id" class="sub-agent-run">
            <div class="run-header">
              <div class="run-status-badge" :class="`status-${run.status}`">
                <Icon v-if="run.status === 'succeeded'" name="checkmark" :size="12" />
                <Icon v-else-if="run.status === 'failed'" name="close" :size="12" />
                <span v-else-if="run.status === 'running'" class="spinner-icon">◉</span>
                <span v-else>○</span>
                <span class="status-text">{{ statusText(run.status) }}</span>
              </div>
              <div class="run-meta">
                <span v-if="run.attempts > 1" class="run-attempts">
                  尝试 {{ run.attempts }} 次
                </span>
                <button
                  v-if="isActive(run.status)"
                  class="cancel-run cancel-run-btn"
                  type="button"
                  :disabled="cancelling.has(run.run_id)"
                  @click.stop="cancelRun(run.run_id)"
                  :aria-label="cancelling.has(run.run_id) ? '取消中' : '取消任务'"
                >
                  <Icon name="close" :size="14" />
                </button>
              </div>
            </div>

            <div v-if="run.status === 'succeeded' && run.result" class="run-result">
              <div class="result-header">执行结果</div>
              <pre class="result-content">{{ run.result }}</pre>
            </div>
            <div v-else-if="run.status === 'failed'" class="run-error">
              <Icon name="warning" :size="16" />
              <span>{{ failureText(run) }}</span>
            </div>
            <div v-else-if="run.status === 'cancelled'" class="run-cancelled">
              {{ cancelText(run.cancel_reason) }}
            </div>
            <div v-else-if="run.status === 'running'" class="run-progress">
              <div class="progress-bar">
                <div class="progress-fill"></div>
              </div>
            </div>
          </div>
          <div v-if="!visibleRuns.length" class="empty-state">
            <span class="empty-icon">📋</span>
            <span>暂无可显示的任务</span>
          </div>
        </template>
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { api } from '@/api'
import type { DeferredRun, DeferredRunStatus } from '@/types'
import { computed, onUnmounted, ref, watch } from 'vue'
import { gsap, useGsap, easeMap } from '@/composables/useGsap'
import Icon from '@/components/Icon.vue'

const props = defineProps<{
  sessionId: string
  runIds: string[]
}>()

const POLL_INTERVAL_MS = 4_000
const expanded = ref(false)
const loading = ref(false)
const available = ref(true)
const runsById = ref<Record<string, DeferredRun>>({})
const cancelling = ref(new Set<string>())
let pollTimer: ReturnType<typeof setTimeout> | null = null

const visibleRuns = computed(() =>
  props.runIds
    .map(runId => runsById.value[runId])
    .filter((run): run is DeferredRun => Boolean(run)),
)

const hasActiveRuns = computed(() =>
  visibleRuns.value.some(run => isActive(run.status))
)

const activeRunsCount = computed(() =>
  visibleRuns.value.filter(run => run.status === 'running').length
)

function isActive(status: DeferredRunStatus): boolean {
  return status === 'queued' || status === 'running'
}

function statusText(status: DeferredRunStatus): string {
  return {
    queued: '等待执行',
    running: '执行中',
    succeeded: '已完成',
    failed: '未完成',
    cancelled: '已取消',
  }[status]
}

function cancelText(reason: DeferredRun['cancel_reason']): string {
  if (reason === 'parent_session_closed') return '父会话已关闭，任务已取消'
  return '任务已取消'
}

function failureText(run: DeferredRun): string {
  if (run.error_message) return run.error_message
  if (run.error_code) return `任务执行失败（${run.error_code}）`
  return '任务执行失败'
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

function schedulePolling() {
  stopPolling()
  if (expanded.value && visibleRuns.value.some(run => isActive(run.status))) {
    pollTimer = setTimeout(() => { void refresh() }, POLL_INTERVAL_MS)
  }
}

function isUnavailableError(error: unknown): boolean {
  // 匹配错误消息中的 404 状态码。使用 \b 词边界以适配
  // "API 请求失败 (404)" 这类括号包裹格式（括号是非单词字符，与数字间存在词边界）。
  return error instanceof Error && /\b404\b/.test(error.message)
}

let refreshing = false

async function refresh() {
  if (!expanded.value || refreshing || !available.value) return
  refreshing = true
  // `loading` 只表示「首次加载、还没有任何内容」。轮询刷新不碰它，
  // 否则展开面板每 4 秒会被“正在读取状态…”整块替换一次。
  const firstLoad = Object.keys(runsById.value).length === 0
  if (firstLoad) loading.value = true
  try {
    const results = await Promise.allSettled(
      props.runIds.map(runId => api.getDeferredRun(props.sessionId, runId)),
    )
    const next = { ...runsById.value }
    for (const result of results) {
      if (result.status === 'fulfilled') {
        next[result.value.run_id] = result.value
      } else if (isUnavailableError(result.reason)) {
        // A disabled feature (or a no-longer-authorized run) has no UI surface.
        available.value = false
        stopPolling()
        return
      }
    }
    runsById.value = next
  } finally {
    refreshing = false
    loading.value = false
    schedulePolling()
  }
}

async function toggle() {
  expanded.value = !expanded.value
  if (expanded.value) {
    await refresh()
  } else {
    stopPolling()
  }
}

// 展开时任务列表淡入上浮（flush post 保证 v-if body 已渲染）
const cardEl = ref<HTMLElement | null>(null)
useGsap((_ctx, contextSafe) => {
  watch(expanded, contextSafe((open) => {
    if (!open || !cardEl.value) return
    const body = cardEl.value.querySelector('.sub-agent-body')
    if (body) gsap.fromTo(body, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.2, ease: easeMap.out })
  }), { flush: 'post' })
})

// 取消按钮的 hover 提醒用 CSS 实现（见 .cancel-run:hover）。
// 之前在这里用 useGsap 查 `.cancel-run` 绑定 mouseenter，但按钮位于
// `v-if="expanded"` 内，setup 阶段集合为空，展开后也不会重新绑定——死代码。

async function cancelRun(runId: string) {
  if (cancelling.value.has(runId)) return
  cancelling.value = new Set(cancelling.value).add(runId)
  try {
    const run = await api.cancelDeferredRun(props.sessionId, runId)
    runsById.value = { ...runsById.value, [run.run_id]: run }
  } catch (error) {
    if (isUnavailableError(error)) available.value = false
  } finally {
    const next = new Set(cancelling.value)
    next.delete(runId)
    cancelling.value = next
    schedulePolling()
  }
}

watch(() => props.runIds.join(','), () => {
  if (expanded.value) void refresh()
})

onUnmounted(stopPolling)
</script>

<style scoped>
.sub-agent-card {
  position: relative;
  margin: 12px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  overflow: hidden;
  transition: all 0.25s var(--ease-out);
}

.sub-agent-card:hover {
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  box-shadow: 0 2px 12px color-mix(in srgb, var(--accent) 8%, transparent);
}

/* 卡片头部 */
.sub-agent-header {
  width: 100%;
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.2s ease;
}

.sub-agent-header:hover {
  background: color-mix(in srgb, var(--accent) 3%, transparent);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

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
  0%, 100% {
    opacity: 0.4;
    transform: scale(0.95);
  }
  50% {
    opacity: 0.8;
    transform: scale(1.1);
  }
}

.sub-agent-icon {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--bg-primary);
  border: 2px solid var(--border);
  color: var(--accent);
  font-size: 16px;
  transition: all 0.2s ease;
}

.header-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.sub-agent-title {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub-agent-subtitle {
  font-size: 12px;
  color: var(--text-secondary);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.active-count-badge {
  padding: 4px 10px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 15%, var(--bg-secondary));
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.sub-agent-toggle {
  color: var(--text-tertiary);
  font-size: 16px;
  transition: transform 0.2s ease;
}

.sub-agent-header[aria-expanded="true"] .sub-agent-toggle {
  transform: rotate(180deg);
}

/* 卡片主体 */
.sub-agent-body {
  border-top: 1px solid var(--border);
  padding: 16px;
  background: var(--bg-primary);
}

.agent-body-enter-active,
.agent-body-leave-active {
  transition: all 0.25s var(--ease-out);
  overflow: hidden;
}

.agent-body-enter-from,
.agent-body-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.agent-body-enter-to,
.agent-body-leave-from {
  opacity: 1;
  max-height: 800px;
}

/* 加载状态 */
.sub-agent-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px;
  color: var(--text-secondary);
  font-size: 13px;
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--accent);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* 任务项 */
.sub-agent-run {
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}

.sub-agent-run:last-child {
  border-bottom: 0;
}

.run-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.run-status-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--bg-secondary);
  font-size: 12px;
  font-weight: 600;
}

.run-status-badge.status-queued {
  background: color-mix(in srgb, var(--text-tertiary) 10%, var(--bg-secondary));
  color: var(--text-secondary);
}

.run-status-badge.status-running {
  background: color-mix(in srgb, var(--accent) 15%, var(--bg-secondary));
  color: var(--accent-text);
}

.run-status-badge.status-succeeded {
  background: color-mix(in srgb, var(--status-ok) 12%, var(--bg-secondary));
  color: var(--status-ok-text);
}

.run-status-badge.status-failed {
  background: color-mix(in srgb, var(--status-error) 12%, var(--bg-secondary));
  color: var(--status-error-text);
}

.run-status-badge.status-cancelled {
  background: var(--bg-secondary);
  color: var(--text-tertiary);
}

.spinner-icon {
  animation: rotate 2s linear infinite;
}

@keyframes rotate {
  to {
    transform: rotate(360deg);
  }
}

.status-text {
  font-weight: 600;
}

.run-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.run-attempts {
  font-size: 11px;
  color: var(--text-secondary);
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--bg-secondary);
}

.cancel-run-btn {
  width: 28px;
  height: 28px;
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

.cancel-run-btn:hover:not(:disabled) {
  background: var(--status-error-solid);
  border-color: var(--status-error-solid);
  color: var(--status-error-solid-text);
  transform: scale(1.05);
}

.cancel-run-btn:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* 执行结果 */
.run-result {
  margin-top: 10px;
}

.result-header {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-tertiary);
  margin-bottom: 6px;
}

.result-content {
  max-height: 240px;
  margin: 0;
  padding: 12px;
  overflow: auto;
  border-radius: 6px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 错误状态 */
.run-error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--status-error) 8%, var(--bg-card));
  border-left: 3px solid var(--status-error);
  color: var(--status-error-text);
  font-size: 12px;
  font-weight: 500;
}

/* 取消状态 */
.run-cancelled {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 12px;
}

/* 进度条 */
.run-progress {
  margin-top: 10px;
}

.progress-bar {
  height: 4px;
  background: var(--bg-secondary);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  width: 40%;
  background: linear-gradient(
    90deg,
    var(--accent),
    color-mix(in srgb, var(--accent) 70%, var(--text-primary))
  );
  border-radius: 2px;
  animation: progress-indeterminate 1.5s ease-in-out infinite;
}

@keyframes progress-indeterminate {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(250%);
  }
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 30px 20px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}

.empty-icon {
  font-size: 32px;
  opacity: 0.5;
}

/* 响应式 */
@media (max-width: 600px) {
  .sub-agent-header {
    min-height: 48px;
    padding: 10px 12px;
  }

  .active-count-badge {
    display: none;
  }

  .run-header {
    flex-direction: column;
    align-items: flex-start;
  }
}

/* 减少动画 */
@media (prefers-reduced-motion: reduce) {
  .sub-agent-card,
  .sub-agent-header,
  .sub-agent-toggle,
  .cancel-run-btn {
    transition: none;
  }

  .status-pulse,
  .loading-spinner,
  .spinner-icon,
  .progress-fill {
    animation: none;
  }

  .agent-body-enter-active,
  .agent-body-leave-active {
    transition: none;
  }
}
</style>
