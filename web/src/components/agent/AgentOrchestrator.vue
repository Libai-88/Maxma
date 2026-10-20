<template>
  <section class="agent-orchestrator" ref="orchestratorEl">
    <!-- 编排器头部 -->
    <header class="orchestrator-header">
      <div class="header-title">
        <Icon name="layers" :size="20" />
        <h2>Agent 编排中心</h2>
        <span class="agent-count-badge">{{ agents.length }} 个任务</span>
      </div>
      <div class="header-controls">
        <button
          type="button"
          class="view-toggle-btn"
          :class="{ active: viewMode === 'flow' }"
          @click="viewMode = 'flow'"
          :aria-pressed="viewMode === 'flow'"
        >
          <Icon name="grid" :size="16" />
          <span>流程图</span>
        </button>
        <button
          type="button"
          class="view-toggle-btn"
          :class="{ active: viewMode === 'list' }"
          @click="viewMode = 'list'"
          :aria-pressed="viewMode === 'list'"
        >
          <Icon name="list" :size="16" />
          <span>列表</span>
        </button>
        <button
          v-if="hasActiveAgents"
          type="button"
          class="cancel-all-btn"
          @click="handleCancelAll"
          aria-label="取消全部运行中任务"
        >
          <Icon name="close" :size="16" />
        </button>
      </div>
    </header>

    <!-- 统计概览 -->
    <div class="orchestrator-stats">
      <div class="stat-item">
        <span class="stat-label">运行中</span>
        <span class="stat-value running">{{ displayCounts[0] }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">等待中</span>
        <span class="stat-value queued">{{ displayCounts[1] }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">已完成</span>
        <span class="stat-value succeeded">{{ displayCounts[2] }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">失败</span>
        <span class="stat-value failed">{{ displayCounts[3] }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">累计耗时</span>
        <span class="stat-value">{{ formatTotalDuration }}</span>
      </div>
    </div>

    <!-- 主内容区 -->
    <Transition name="view-switch" mode="out-in">
      <!-- 流程图视图 -->
      <div v-if="viewMode === 'flow'" class="flow-view" key="flow">
        <AgentFlowCanvas
          :agents="agents"
          :dependencies="dependencies"
          :selected-id="selectedAgentId"
          @select="handleSelectAgent"
          @cancel="handleCancelAgent"
        />
      </div>

      <!-- 列表视图 -->
      <div v-else class="list-view" key="list">
        <TransitionGroup name="agent-list" tag="div" class="agent-list">
          <AgentCard
            v-for="agent in sortedAgents"
            :key="agent.id"
            :agent-id="agent.id"
            :title="agent.title"
            :description="agent.description"
            :status="agent.status"
            :attempts="agent.attempts"
            :duration="agent.duration"
            :progress="agent.progress"
            :result="agent.result"
            :error="agent.error"
            :cancel-reason="agent.cancelReason"
            :timeline="agent.timeline"
            :cancellable="agent.cancellable"
            @cancel="handleCancelAgent"
            @expand="handleExpandAgent"
            @collapse="handleCollapseAgent"
          />
        </TransitionGroup>

        <!-- 空状态 -->
        <div v-if="agents.length === 0" class="empty-state">
          <div class="empty-icon">🤖</div>
          <h3>暂无 Agent 任务</h3>
          <p>当有后台任务运行时，会在这里显示</p>
        </div>
      </div>
    </Transition>

    <!-- 浮动操作栏（仅在有活跃任务时显示） -->
    <Transition name="fab">
      <div v-if="hasActiveAgents" class="floating-action-bar">
        <div class="fab-content">
          <div class="fab-status">
            <div class="fab-spinner"></div>
            <span>{{ runningCount }} 个任务正在执行</span>
          </div>
          <button
            type="button"
            class="fab-action cancel-all"
            @click="handleCancelAll"
            :disabled="cancelling"
          >
            {{ cancelling ? '取消中...' : '取消全部' }}
          </button>
        </div>
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { gsap, useGsap, easeMap } from '@/composables/useGsap'
import Icon from '@/components/Icon.vue'
import AgentCard from './AgentCard.vue'
import AgentFlowCanvas from './AgentFlowCanvas.vue'
import type { Agent, AgentDependency } from '@/types/agent'

const props = withDefaults(
  defineProps<{
    agents: Agent[]
    dependencies?: AgentDependency[]
  }>(),
  {
    dependencies: () => [],
  }
)

const emit = defineEmits<{
  cancelAgent: [agentId: string]
  cancelAll: []
  selectAgent: [agentId: string]
  expandAgent: [agentId: string]
  collapseAgent: [agentId: string]
}>()

const orchestratorEl = ref<HTMLElement | null>(null)
const viewMode = ref<'flow' | 'list'>('list')
const cancelling = ref(false)
/** 批量取消的复位定时器。卸载时必须清掉。 */
let cancelResetTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 当前选中的任务 id。
 * 提升到编排器这一层：流程图与列表两个视图共享同一份选中态，
 * 切视图时不会「选中的东西凭空消失」。
 */
const selectedAgentId = ref<string | null>(null)

/**
 * 统计数字的展示值（供 GSAP 补间写入）。
 * 单独用 ref 承载，模板只读它——避免动画期间直接改 DOM 与 Vue 渲染打架。
 */
const displayCounts = ref<number[]>([0, 0, 0, 0])

// 统计数据
const runningCount = computed(() =>
  props.agents.filter(a => a.status === 'running').length
)

const queuedCount = computed(() =>
  props.agents.filter(a => a.status === 'queued').length
)

const succeededCount = computed(() =>
  props.agents.filter(a => a.status === 'succeeded').length
)

const failedCount = computed(() =>
  props.agents.filter(a => a.status === 'failed').length
)

const hasActiveAgents = computed(() => runningCount.value > 0 || queuedCount.value > 0)

/**
 * 各任务耗时之和（**累计**，不是墙钟时长）。
 *
 * 4 个任务并发跑、各花 10 秒，这里是 40 秒——真实墙钟只有 10 秒。
 * 所以标签写「累计耗时」而不是「总耗时」，免得误导。
 */
const totalDuration = computed(() =>
  props.agents.reduce((sum, agent) => sum + (agent.duration || 0), 0)
)

const formatTotalDuration = computed(() => {
  const ms = totalDuration.value
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
})

// 排序后的agents（运行中 > 等待中 > 已完成 > 失败 > 已取消）
const sortedAgents = computed(() => {
  const statusOrder = {
    running: 0,
    queued: 1,
    succeeded: 2,
    failed: 3,
    cancelled: 4,
  }
  return [...props.agents].sort((a, b) => {
    return statusOrder[a.status] - statusOrder[b.status]
  })
})

function handleCancelAgent(agentId: string) {
  emit('cancelAgent', agentId)
}

async function handleCancelAll() {
  if (cancelling.value) return
  cancelling.value = true
  emit('cancelAll')
  // 父组件负责真正取消；这里只负责避免连点。
  cancelResetTimer = setTimeout(() => {
    cancelling.value = false
    cancelResetTimer = null
  }, 1500)
}

function handleSelectAgent(agentId: string) {
  selectedAgentId.value = agentId
  emit('selectAgent', agentId)
}

function handleExpandAgent(agentId: string) {
  emit('expandAgent', agentId)
}

function handleCollapseAgent(agentId: string) {
  emit('collapseAgent', agentId)
}

// 自动刷新：真正的数据拉取由父组件负责（useAgentTasks 会按活跃状态轮询）。
// 这里不设空转定时器——原实现每 tick 只打一条 debug 日志，白耗一个定时器。
// 父组件更新 agents 数组即可驱动本组件重渲染。

// 入场动画
useGsap(() => {
  if (!orchestratorEl.value) return

  const header = orchestratorEl.value.querySelector('.orchestrator-header')
  const stats = orchestratorEl.value.querySelector('.orchestrator-stats')

  if (header) {
    gsap.fromTo(
      header,
      { opacity: 0, y: -20 },
      { opacity: 1, y: 0, duration: 0.5, ease: easeMap.out }
    )
  }

  if (stats) {
    gsap.fromTo(
      stats,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.5, delay: 0.1, ease: easeMap.out }
    )
  }
})

// 统计数字变化动画
//
// 用响应式计数器承载动画值，而不是直接改 DOM 的 textContent：后者会与
// Vue 的渲染打架（Vue 认为模板里的 {{ runningCount }} 才是真值，下次
// patch 会把动画中间值覆盖掉，表现为数字跳变）。
useGsap((_ctx, contextSafe) => {
  const tweenState = { running: 0, queued: 0, succeeded: 0, failed: 0 }

  watch(
    [runningCount, queuedCount, succeededCount, failedCount],
    contextSafe(() => {
      const targets = {
        running: runningCount.value,
        queued: queuedCount.value,
        succeeded: succeededCount.value,
        failed: failedCount.value,
      }
      const keys = Object.keys(targets) as Array<keyof typeof targets>
      keys.forEach((key, idx) => {
        // 首次渲染不补间：直接从真值起步。否则首帧全是 0，
        // 还要等 0.5s 才跳到真实数字。
        if (tweenState[key] === 0 && targets[key] !== 0) {
          tweenState[key] = targets[key]
          displayCounts.value[idx] = targets[key]
          return
        }
        const tween = { value: tweenState[key] }
        gsap.to(tween, {
          value: targets[key],
          duration: 0.5,
          ease: 'power2.out',
          onUpdate: function () {
            tweenState[key] = Math.round(this.targets()[0].value)
            // 直接改数字源的 ref 会触发整表重渲染，代价大；这里只更新
            // 对应的展示 ref，Vue 负责把文本写进 DOM。
            displayCounts.value[idx] = tweenState[key]
          },
        })
      })
    }),
    // immediate：首帧就同步一次真实值，否则初始渲染全是 0，
    // 要等某次状态变化才会跳到正确数字。
    { immediate: true }
  )
})

onUnmounted(() => {
  if (cancelResetTimer) {
    clearTimeout(cancelResetTimer)
    cancelResetTimer = null
  }
})
</script>

<style scoped>
.agent-orchestrator {
  position: relative;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

/* 头部 */
.orchestrator-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 2px solid var(--border);
}

.header-title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-title h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  font-family: var(--font-display);
  color: var(--text-primary);
}

.agent-count-badge {
  padding: 4px 10px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent) 15%, var(--bg-secondary));
  color: var(--accent);
  font-size: 12px;
  font-weight: 600;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.view-toggle-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.view-toggle-btn:hover {
  background: var(--bg-hover);
  border-color: var(--text-secondary);
}

.view-toggle-btn.active {
  background: var(--accent-solid);
  border-color: var(--accent-solid);
  color: var(--accent-solid-text);
}

.cancel-all-btn {
  width: 36px;
  height: 36px;
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

.cancel-all-btn:hover {
  background: var(--bg-hover);
  border-color: var(--status-error);
  color: var(--status-error-text);
}

/* 统计概览 */
.orchestrator-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  border-radius: var(--radius-lg);
  background: var(--bg-card);
  border: 1px solid var(--border);
  transition: all 0.2s ease;
}

.stat-item:hover {
  border-color: var(--accent);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 10%, transparent);
}

.stat-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-tertiary);
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--text-primary);
}

.stat-value.running {
  color: var(--accent-text);
}

.stat-value.queued {
  color: var(--text-secondary);
}

.stat-value.succeeded {
  color: var(--status-ok-text);
}

.stat-value.failed {
  color: var(--status-error-text);
}

/* 视图切换动画 */
.view-switch-enter-active,
.view-switch-leave-active {
  transition: all 0.3s var(--ease-out);
}

.view-switch-enter-from {
  opacity: 0;
  transform: translateX(20px);
}

.view-switch-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

/* 列表视图 */
.list-view {
  min-height: 200px;
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.agent-list-move,
.agent-list-enter-active,
.agent-list-leave-active {
  transition: all 0.4s var(--ease-out);
}

.agent-list-enter-from {
  opacity: 0;
  transform: translateY(20px);
}

.agent-list-leave-to {
  opacity: 0;
  transform: translateY(-20px);
}

.agent-list-leave-active {
  position: absolute;
  width: 100%;
}

/* 空状态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-state h3 {
  margin: 0 0 8px 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.empty-state p {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
}

/* 浮动操作栏 */
.floating-action-bar {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 100;
}

.fab-content {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 20px;
  border-radius: 28px;
  background: var(--bg-card);
  border: 2px solid var(--accent);
  box-shadow: 0 4px 20px color-mix(in srgb, var(--accent) 20%, transparent);
  backdrop-filter: blur(10px);
}

.fab-status {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
}

.fab-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--accent);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.fab-action {
  padding: 8px 16px;
  border: none;
  border-radius: 16px;
  background: var(--accent-solid);
  color: var(--accent-solid-text);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.fab-action:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 85%, var(--text-primary));
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.fab-action:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.fab-action.cancel-all {
  background: var(--status-error-solid);
  color: var(--status-error-solid-text);
}

.fab-action.cancel-all:hover:not(:disabled) {
  background: color-mix(in srgb, var(--status-error-solid) 85%, var(--text-primary));
}

.fab-enter-active,
.fab-leave-active {
  transition: all 0.3s var(--ease-out);
}

.fab-enter-from,
.fab-leave-to {
  opacity: 0;
  transform: translateY(20px) scale(0.9);
}

/* 响应式 */
@media (max-width: 768px) {
  .agent-orchestrator {
    padding: 16px;
  }

  .orchestrator-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .header-controls {
    width: 100%;
    justify-content: flex-end;
  }

  .orchestrator-stats {
    grid-template-columns: repeat(2, 1fr);
  }

  .floating-action-bar {
    bottom: 16px;
    right: 16px;
    left: 16px;
  }

  .fab-content {
    width: 100%;
    justify-content: space-between;
  }
}

@media (max-width: 480px) {
  .view-toggle-btn span {
    display: none;
  }

  .orchestrator-stats {
    grid-template-columns: 1fr;
  }
}

/* 减少动画 */
@media (prefers-reduced-motion: reduce) {
  .view-switch-enter-active,
  .view-switch-leave-active,
  .agent-list-move,
  .agent-list-enter-active,
  .agent-list-leave-active,
  .fab-enter-active,
  .fab-leave-active {
    transition: none;
  }

  .fab-spinner {
    animation: none;
  }
}
</style>
