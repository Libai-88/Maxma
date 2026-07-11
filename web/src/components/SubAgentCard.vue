<template>
  <section v-if="available" class="sub-agent-card">
    <button
      class="sub-agent-header"
      type="button"
      :aria-expanded="expanded"
      @click="toggle"
    >
      <span class="sub-agent-icon" aria-hidden="true">◌</span>
      <span class="sub-agent-title">后台子任务</span>
      <span class="sub-agent-count">{{ runIds.length }} 项</span>
      <span class="sub-agent-toggle" aria-hidden="true">{{ expanded ? '⌃' : '⌄' }}</span>
    </button>

    <div v-if="expanded" class="sub-agent-body">
      <div v-if="loading" class="sub-agent-loading">正在读取状态…</div>
      <template v-else>
        <div v-for="run in visibleRuns" :key="run.run_id" class="sub-agent-run">
          <div class="run-summary">
            <span class="run-status" :class="run.status">{{ statusText(run.status) }}</span>
            <span v-if="run.attempts > 0" class="run-attempts">已尝试 {{ run.attempts }} 次</span>
            <button
              v-if="isActive(run.status)"
              class="cancel-run"
              type="button"
              :disabled="cancelling.has(run.run_id)"
              @click.stop="cancelRun(run.run_id)"
            >
              {{ cancelling.has(run.run_id) ? '取消中…' : '取消' }}
            </button>
          </div>
          <pre v-if="run.status === 'succeeded' && run.result" class="run-result">{{ run.result }}</pre>
          <p v-else-if="run.status === 'failed'" class="run-note">任务未完成</p>
          <p v-else-if="run.status === 'cancelled'" class="run-note">{{ cancelText(run.cancel_reason) }}</p>
        </div>
        <p v-if="!visibleRuns.length" class="run-note">暂无可显示的任务状态</p>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { api } from '@/api'
import type { DeferredRun, DeferredRunStatus } from '@/types'
import { computed, onUnmounted, ref, watch } from 'vue'

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
  return error instanceof Error && /(?:\\s|^)404(?:\\s|$)/.test(error.message)
}

async function refresh() {
  if (!expanded.value || loading.value || !available.value) return
  loading.value = true
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
  margin: 8px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-card);
  overflow: hidden;
}
.sub-agent-header {
  width: 100%;
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
}
.sub-agent-header:hover { background: var(--bg-hover); }
.sub-agent-icon { color: var(--accent); font-size: 16px; }
.sub-agent-title { color: var(--text-primary); font-size: 13px; font-weight: 600; }
.sub-agent-count, .run-attempts { font-size: 12px; color: var(--text-secondary); }
.sub-agent-toggle { margin-left: auto; }
.sub-agent-body { border-top: 1px solid var(--border); padding: 8px 14px 12px; }
.sub-agent-loading, .run-note { margin: 0; color: var(--text-secondary); font-size: 12px; }
.sub-agent-run { padding: 8px 0; border-bottom: 1px solid var(--border); }
.sub-agent-run:last-child { border-bottom: 0; }
.run-summary { min-height: 26px; display: flex; align-items: center; gap: 8px; }
.run-status { font-size: 12px; font-weight: 600; }
.run-status.queued { color: var(--text-secondary); }
.run-status.running { color: var(--accent); }
.run-status.succeeded { color: var(--status-success, #198754); }
.run-status.failed, .run-status.cancelled { color: var(--text-secondary); }
.cancel-run {
  margin-left: auto;
  min-height: 26px;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
}
.cancel-run:hover:not(:disabled) { border-color: var(--text-secondary); color: var(--text-primary); }
.cancel-run:disabled { cursor: wait; opacity: .65; }
.run-result {
  max-height: 240px;
  margin: 7px 0 0;
  padding: 8px 10px;
  overflow: auto;
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
