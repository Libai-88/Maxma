<template>
  <section v-if="available" class="workflow-card" aria-label="工作流">
    <button
      class="workflow-header"
      type="button"
      :aria-expanded="expanded"
      @click="toggle"
    >
      <span class="workflow-icon" aria-hidden="true">◇</span>
      <span class="workflow-title">工作流</span>
      <span class="workflow-count">{{ runs.length }} 项</span>
      <span class="workflow-toggle" aria-hidden="true">{{ expanded ? '⌃' : '⌄' }}</span>
    </button>

    <div v-if="expanded" class="workflow-body">
      <div v-if="loading" class="workflow-note">正在读取状态…</div>
      <template v-else>
        <div v-if="workflowIds.length" class="workflow-starts">
          <button
            v-for="workflowId in workflowIds"
            :key="workflowId"
            class="start-workflow"
            type="button"
            :disabled="starting.has(workflowId)"
            @click="start(workflowId)"
          >
            {{ starting.has(workflowId) ? '启动中…' : `运行 ${workflowLabel(workflowId)}` }}
          </button>
        </div>
        <div v-for="run in runs" :key="run.run_id" class="workflow-run">
          <div class="run-summary">
            <span class="run-name">{{ workflowLabel(run.workflow_id) }}</span>
            <span class="run-status" :class="run.status">{{ statusText(run.status) }}</span>
            <button
              v-if="isActive(run.status)"
              class="run-action"
              type="button"
              :disabled="acting.has(run.run_id)"
              @click="cancel(run.run_id)"
            >
              {{ acting.has(run.run_id) ? '处理中…' : '取消' }}
            </button>
            <button
              v-else-if="run.status === 'failed'"
              class="run-action"
              type="button"
              :disabled="acting.has(run.run_id)"
              @click="resume(run.run_id)"
            >
              {{ acting.has(run.run_id) ? '处理中…' : '恢复' }}
            </button>
          </div>
          <p class="run-phase">{{ phaseText(run) }}</p>
        </div>
        <p v-if="!runs.length" class="workflow-note">暂无工作流记录</p>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { api } from '@/api'
import type { WorkflowRun, WorkflowRunStatus } from '@/types'
import { onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{ sessionId: string }>()

const POLL_INTERVAL_MS = 4_000
const available = ref(false)
const expanded = ref(false)
const loading = ref(false)
const workflowIds = ref<string[]>([])
const runs = ref<WorkflowRun[]>([])
const starting = ref(new Set<string>())
const acting = ref(new Set<string>())
let pollTimer: ReturnType<typeof setTimeout> | null = null

function isUnavailableError(error: unknown): boolean {
  return error instanceof Error && /(?:\s|^)404(?:\s|$)/.test(error.message)
}

function isActive(status: WorkflowRunStatus): boolean {
  return status === 'queued' || status === 'running'
}

function statusText(status: WorkflowRunStatus): string {
  return {
    queued: '等待执行',
    running: '执行中',
    succeeded: '已完成',
    failed: '未完成',
    cancelled: '已取消',
  }[status]
}

function workflowLabel(workflowId: string): string {
  return workflowId === 'session-review' ? '会话检查' : workflowId
}

function phaseText(run: WorkflowRun): string {
  if (run.current_step_id) return `当前步骤：${run.current_step_id}`
  if (run.status === 'succeeded') return '所有已注册步骤已完成'
  if (run.status === 'cancelled') return run.cancel_reason === 'parent_session_closed' ? '父会话已关闭' : '已由用户取消'
  if (run.status === 'failed') return '未能安全完成，可在可恢复时继续'
  return '等待已注册步骤开始'
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

function schedulePolling() {
  stopPolling()
  if (available.value && expanded.value && runs.value.some(run => isActive(run.status))) {
    pollTimer = setTimeout(() => { void refreshRuns() }, POLL_INTERVAL_MS)
  }
}

function hide() {
  available.value = false
  expanded.value = false
  stopPolling()
}

async function load() {
  try {
    const [definitions, listedRuns] = await Promise.all([
      api.listWorkflowDefinitions(),
      api.listWorkflowRuns(props.sessionId),
    ])
    workflowIds.value = definitions.workflow_ids
    runs.value = listedRuns.runs
    available.value = true
  } catch (error) {
    if (isUnavailableError(error)) hide()
  }
}

async function refreshRuns() {
  if (!available.value || !expanded.value || loading.value) return
  loading.value = true
  try {
    runs.value = (await api.listWorkflowRuns(props.sessionId)).runs
  } catch (error) {
    if (isUnavailableError(error)) hide()
  } finally {
    loading.value = false
    schedulePolling()
  }
}

async function toggle() {
  expanded.value = !expanded.value
  if (expanded.value) await refreshRuns()
  else stopPolling()
}

async function start(workflowId: string) {
  if (starting.value.has(workflowId)) return
  starting.value = new Set(starting.value).add(workflowId)
  try {
    const run = await api.startWorkflow(props.sessionId, workflowId)
    runs.value = [run, ...runs.value.filter(existing => existing.run_id !== run.run_id)]
  } catch (error) {
    if (isUnavailableError(error)) hide()
  } finally {
    const next = new Set(starting.value)
    next.delete(workflowId)
    starting.value = next
    schedulePolling()
  }
}

async function updateRun(runId: string, action: 'cancel' | 'resume') {
  if (acting.value.has(runId)) return
  acting.value = new Set(acting.value).add(runId)
  try {
    const run = action === 'cancel'
      ? await api.cancelWorkflowRun(props.sessionId, runId)
      : await api.resumeWorkflowRun(props.sessionId, runId)
    runs.value = runs.value.map(existing => existing.run_id === run.run_id ? run : existing)
  } catch (error) {
    if (isUnavailableError(error)) hide()
  } finally {
    const next = new Set(acting.value)
    next.delete(runId)
    acting.value = next
    schedulePolling()
  }
}

function cancel(runId: string) { return updateRun(runId, 'cancel') }
function resume(runId: string) { return updateRun(runId, 'resume') }

watch(() => props.sessionId, () => {
  runs.value = []
  workflowIds.value = []
  available.value = false
  stopPolling()
  void load()
})

onMounted(() => { void load() })
onUnmounted(stopPolling)
</script>

<style scoped>
.workflow-card { width: min(768px, calc(100% - 48px)); margin: 0 auto 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-card); overflow: hidden; }
.workflow-header { display: flex; align-items: center; width: 100%; min-height: 38px; gap: 8px; padding: 8px 14px; border: 0; background: transparent; color: var(--text-secondary); cursor: pointer; font: inherit; text-align: left; }
.workflow-header:hover { background: var(--bg-hover); }.workflow-header:focus-visible, .start-workflow:focus-visible, .run-action:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.workflow-icon { color: var(--accent); font-size: 16px; }.workflow-title, .run-name { color: var(--text-primary); font-size: 13px; font-weight: 600; }.workflow-count, .run-phase, .workflow-note { color: var(--text-secondary); font-size: 12px; }.workflow-toggle, .run-action { margin-left: auto; }
.workflow-body { border-top: 1px solid var(--border); padding: 8px 14px 12px; }.workflow-starts { display: flex; flex-wrap: wrap; gap: 6px; padding-bottom: 8px; }.workflow-run { padding: 8px 0; border-top: 1px solid var(--border); }.run-summary { display: flex; min-height: 26px; align-items: center; gap: 8px; }.run-status { font-size: 12px; font-weight: 600; }.run-status.queued { color: var(--text-secondary); }.run-status.running { color: var(--accent); }.run-status.succeeded { color: var(--status-success, #198754); }.run-status.failed, .run-status.cancelled { color: var(--text-secondary); }.run-phase, .workflow-note { margin: 5px 0 0; }
.start-workflow, .run-action { min-height: 26px; padding: 3px 8px; border: 1px solid var(--border); border-radius: 4px; background: transparent; color: var(--text-secondary); cursor: pointer; font: inherit; font-size: 12px; }.start-workflow:hover:not(:disabled), .run-action:hover:not(:disabled) { border-color: var(--text-secondary); color: var(--text-primary); }.start-workflow:disabled, .run-action:disabled { cursor: wait; opacity: .65; }
</style>
