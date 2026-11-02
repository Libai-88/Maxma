<template>
  <div class="agent-task-center">
    <header class="page-header">
      <div class="header-text">
        <h1>Agent 任务中心</h1>
        <p class="page-subtitle">
          当前会话的后台子任务。数据来自后端 deferred-runs 接口，不是演示数据。
        </p>
      </div>
      <div class="header-actions">
        <button
          type="button"
          class="refresh-btn"
          :disabled="loading && !tasks.length"
          @click="refresh"
          aria-label="刷新任务列表"
        >
          <Icon name="refresh" :size="16" />
          <span>{{ loading && !tasks.length ? '加载中' : '刷新' }}</span>
        </button>
      </div>
    </header>

    <!-- 能力不可用：整个面板无意义，直接说明而不是报错 -->
    <div v-if="unavailable" class="state-panel">
      <div class="state-icon" aria-hidden="true">
        <Icon name="info" :size="24" />
      </div>
      <h2>后台子任务功能未启用</h2>
      <p>当前后端未开放 deferred-runs 能力，因此这里没有可展示的任务。</p>
    </div>

    <!-- 加载中 -->
    <div v-else-if="loading && !tasks.length" class="state-panel">
      <div class="loading-spinner" aria-hidden="true"></div>
      <p>正在读取后台任务…</p>
    </div>

    <!-- 错误 -->
    <div v-else-if="error && !tasks.length" class="state-panel is-error">
      <div class="state-icon" aria-hidden="true">
        <Icon name="warning" :size="24" />
      </div>
      <h2>读取任务失败</h2>
      <p>{{ error }}</p>
      <button type="button" class="refresh-btn" @click="refresh">重试</button>
    </div>

    <!-- 空状态 -->
    <div v-else-if="!tasks.length" class="state-panel">
      <div class="state-icon" aria-hidden="true">
        <Icon name="cpu" :size="24" />
      </div>
      <h2>暂无后台子任务</h2>
      <p>当你在对话中派发子 Agent 时，任务会出现在这里。</p>
    </div>

    <!-- 任务本体 -->
    <template v-else>
      <AgentOrchestrator
        :agents="agentTasks"
        :dependencies="agentDependencies"
        @cancel-agent="handleCancelAgent"
        @cancel-all="handleCancelAll"
        @expand-agent="handleExpandAgent"
      />

      <p v-if="hasMore" class="list-truncated">
        仅显示最近一批已结束任务；更早的记录仍保留在后台。
      </p>

      <section class="timeline-section">
        <AgentStatusTimeline
          :events="timelineEvents"
          :is-live="hasActive"
          @action="handleTimelineAction"
        />
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/Icon.vue'
import AgentOrchestrator from '@/components/agent/AgentOrchestrator.vue'
import AgentStatusTimeline from '@/components/agent/AgentStatusTimeline.vue'
import { useAgentTasks } from '@/composables/useAgentTasks'
import { buildAgentDependencies } from '@/utils/agentDependencies'
import { useSessionStore } from '@/stores/session'
import type { Agent, TimelineEvent } from '@/types/agent'

const sessionStore = useSessionStore()

const {
  tasks,
  loading,
  error,
  unavailable,
  hasActive,
  hasMore,
  refresh,
  loadRunResult,
  cancel,
  cancelAll,
} = useAgentTasks({
  sessionId: () => sessionStore.sessionId,
})

const STATUS_TEXT: Record<string, string> = {
  queued: '等待执行',
  running: '执行中',
  succeeded: '已完成',
  failed: '未完成',
  cancelled: '已取消',
}

/**
 * 把真实任务映射成 Agent 卡片模型。
 *
 * 隐私边界：标题只使用不透明的 run_id 短串。ADR 0003 规定完整 prompt、
 * 子会话记录与原始工具结果不得进入父级摘要与 UI 缓存——后端投影
 * （`toDeferredRunView`）已不再返回 `task` / `name`，这里也没有可读的字段。
 */
const ERROR_TEXT: Record<string, string> = {
  timeout: '执行超时',
  deferred_run_failed: '子任务执行失败',
}

/** 失败原因：优先用后端透传的 message，其次把错误码翻成人话。 */
function failureText(task: { error_code?: string; error_message?: string }): string | undefined {
  if (task.error_message) return task.error_message
  if (!task.error_code) return undefined
  return ERROR_TEXT[task.error_code] ?? `执行失败（${task.error_code}）`
}

const agentTasks = computed<Agent[]>(() =>
  tasks.value.map(task => ({
    id: task.run_id,
    title: `子任务 ${task.run_id.slice(0, 8)}`,
    description: STATUS_TEXT[task.status] ?? task.status,
    status: task.status,
    attempts: task.attempts,
    duration: task.duration,
    result: task.result ?? undefined,
    error: failureText(task),
    cancelReason: task.cancel_reason ?? undefined,
    cancellable: task.cancellable,
  })),
)

const agentDependencies = computed(() => buildAgentDependencies(tasks.value))

const timelineEvents = computed<TimelineEvent[]>(() =>
  tasks.value.map(task => {
    const eventType: TimelineEvent['type'] =
      task.status === 'succeeded'
        ? 'complete'
        : task.status === 'failed'
          ? 'error'
          : task.status === 'running'
            ? 'progress'
            : 'info'

    const actions: TimelineEvent['actions'] = []
    if (task.cancellable) {
      actions.push({ label: '取消', type: 'cancel' })
    }

    return {
      id: task.run_id,
      type: eventType,
      status: task.status,
      title: `子任务 ${task.run_id.slice(0, 8)}`,
      description: STATUS_TEXT[task.status] ?? task.status,
      timestamp: task.updated_at || task.created_at,
      duration: task.duration,
      metadata: {
        状态: STATUS_TEXT[task.status] ?? task.status,
        尝试次数: task.attempts,
        ...(task.error_code ? { 错误码: task.error_code } : {}),
      },
      ...(actions.length ? { actions } : {}),
    }
  }),
)

function handleCancelAgent(agentId: string) {
  void cancel(agentId)
}

function handleCancelAll() {
  void cancelAll()
}

function handleExpandAgent(agentId: string) {
  // 列表接口不返回 result 全文，展开时补一次单条详情。
  // 已经懒加载过就不再重复请求。
  const task = tasks.value.find(t => t.run_id === agentId)
  if (task?.result != null) return
  void loadRunResult(agentId)
}

function handleTimelineAction(eventId: string, actionType: string) {
  if (actionType === 'cancel') {
    void cancel(eventId)
  }
}
</script>

<style scoped>
.agent-task-center {
  width: 100%;
  min-height: 100vh;
  padding: 32px 20px 64px;
  background: var(--bg-primary);
}

.page-header {
  max-width: 1200px;
  margin: 0 auto 24px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.page-header h1 {
  margin: 0 0 6px;
  font-size: 28px;
  font-weight: 700;
  font-family: var(--font-display);
  color: var(--text-primary);
}

.page-subtitle {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
}

.header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s var(--ease-out), color 0.2s var(--ease-out);
}

.refresh-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.refresh-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.timeline-section {
  max-width: 1200px;
  margin: 32px auto 0;
}

.list-truncated {
  max-width: 1200px;
  margin: 12px auto 0;
  font-size: 12px;
  color: var(--text-tertiary);
  text-align: right;
}

/* 状态面板 */
.state-panel {
  max-width: 900px;
  margin: 0 auto;
  padding: 56px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

.state-panel h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.state-panel p {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
}

.state-panel.is-error h2 {
  color: var(--status-error-text);
}

.state-icon {
  color: var(--text-tertiary);
}

.loading-spinner {
  width: 24px;
  height: 24px;
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

@media (max-width: 640px) {
  .page-header {
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .loading-spinner {
    animation: none;
  }
}
</style>
