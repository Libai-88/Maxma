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
          :disabled="loading"
          @click="refresh"
          aria-label="刷新任务列表"
        >
          <Icon name="refresh" :size="16" />
          <span>{{ loading ? '刷新中' : '刷新' }}</span>
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
        @select-agent="handleSelectAgent"
      />

      <section class="timeline-section">
        <h2 class="section-title">执行时间线</h2>
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
import { useSessionStore } from '@/stores/session'
import type { Agent, AgentDependency, TimelineEvent } from '@/types/agent'

const sessionStore = useSessionStore()

const {
  tasks,
  loading,
  error,
  unavailable,
  hasActive,
  refresh,
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
 * 子会话记录与原始工具结果不得进入父级摘要与 UI 缓存——后端记录里虽有
 * `task` / `name` 字段，前端 `DeferredRun` 类型刻意不暴露，这里同样不读。
 */
const agentTasks = computed<Agent[]>(() =>
  tasks.value.map(task => ({
    id: task.run_id,
    title: `子任务 ${task.run_id.slice(0, 8)}`,
    description: STATUS_TEXT[task.status] ?? task.status,
    status: task.status,
    attempts: task.attempts,
    duration: task.duration,
    result: task.result ?? undefined,
    error: task.error_code,
    cancelReason: task.cancel_reason ?? undefined,
    cancellable: task.cancellable,
  })),
)

/**
 * 从真实数据推导依赖边。
 *
 * 后端不记录子任务之间的依赖关系，只记录每个任务所属的 `parent_turn_id`。
 * 可据实推导的结构是：
 *   - 同一回合内的任务是**并行**兄弟（同一轮一起派发）；
 *   - 相邻回合之间是**顺序**关系（对话回合依次发生）。
 * 于是把「上一回合的最后一个任务」作为「本回合各任务」的前驱：
 * 顺序边连到首个任务，并行边连到其余任务。没有任何虚构的节点。
 */
const agentDependencies = computed<AgentDependency[]>(() => {
  const deps: AgentDependency[] = []
  // 按回合分组，组内保持后端返回的顺序（后端按 created_at 倒序）。
  const turns = new Map<string, string[]>()
  for (const task of tasks.value) {
    const turn = task.parent_turn_id ?? '__no_turn__'
    const bucket = turns.get(turn)
    if (bucket) bucket.push(task.run_id)
    else turns.set(turn, [task.run_id])
  }

  const groups = [...turns.values()].filter(group => group.length > 0)
  for (let i = 1; i < groups.length; i += 1) {
    const prev = groups[i - 1]
    const current = groups[i]
    const predecessor = prev[prev.length - 1]
    current.forEach((runId, idx) => {
      deps.push({
        from: predecessor,
        to: runId,
        type: idx === 0 ? 'sequential' : 'parallel',
      })
    })
  }
  return deps
})

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

function handleSelectAgent(agentId: string) {
  // 选中态由编排器内部维护；此处保留出口便于将来接「查看详情」跳转。
  void agentId
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

.section-title {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 600;
  font-family: var(--font-display);
  color: var(--text-primary);
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
