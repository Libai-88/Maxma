<template>
  <div class="goal-mode-panel" role="group" aria-label="目标模式">
    <div class="goal-panel-heading">
      <span>目标模式</span>
      <span v-if="activeGoal" class="goal-status-badge" :class="statusClass">{{ statusLabel }}</span>
    </div>
    <p class="goal-panel-desc">设定一个持续目标，Agent 会在后续轮次中自主朝目标推进（OMP goal 模式）。</p>

    <!-- 目标输入 + 启动 -->
    <div class="goal-input-row">
      <input
        v-model="objective"
        class="goal-input"
        type="text"
        :placeholder="activeGoal ? '输入新目标以替换当前目标…' : '输入目标，如：完成本周周报并提交'"
        aria-label="目标内容"
        @keydown.enter="startGoal"
      />
      <button class="goal-btn" type="button" :disabled="!objective.trim()" @click="startGoal">
        {{ activeGoal ? '替换' : '开始' }}
      </button>
    </div>

    <!-- 当前目标状态 -->
    <div v-if="activeGoal" class="goal-current">
      <div class="goal-current-text" :title="activeGoal.objective">{{ activeGoal.objective }}</div>
      <div v-if="activeGoal.tokenBudget" class="goal-usage">
        已用 {{ activeGoal.tokensUsed ?? 0 }} / {{ activeGoal.tokenBudget }} tokens
      </div>
      <div class="goal-actions">
        <button
          v-if="activeGoal.status === 'active'"
          class="goal-btn goal-btn--small"
          type="button"
          @click="send('pause')"
        >暂停</button>
        <button
          v-else-if="activeGoal.status === 'paused'"
          class="goal-btn goal-btn--small"
          type="button"
          @click="send('resume')"
        >恢复</button>
        <button class="goal-btn goal-btn--small goal-btn--danger" type="button" @click="send('drop')">放弃</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GoalChannelState } from '@/stores/chat'
import { showError, showSuccess } from '@/lib/toast'

const props = defineProps<{
  goalState: GoalChannelState | null
  sendAction: (action: 'set' | 'replace' | 'pause' | 'resume' | 'drop', objective?: string, tokenBudget?: number) => boolean
}>()

const objective = ref('')

const activeGoal = computed(() => props.goalState?.goal ?? null)

const STATUS_LABELS: Record<string, string> = {
  active: '推进中',
  paused: '已暂停',
  complete: '已完成',
  dropped: '已放弃',
  'budget-limited': '预算受限',
}
const statusLabel = computed(() => STATUS_LABELS[activeGoal.value?.status ?? ''] ?? activeGoal.value?.status ?? '')
const statusClass = computed(() => `goal-status--${activeGoal.value?.status ?? 'none'}`)

// 目标被放弃/完成后清空输入框，方便重新设定
watch(() => activeGoal.value?.status, (status) => {
  if (status === 'dropped' || status === 'complete') {
    objective.value = ''
  }
})

function startGoal() {
  const text = objective.value.trim()
  if (!text) return
  const ok = props.sendAction(activeGoal.value ? 'replace' : 'set', text)
  if (!ok) {
    showError('目标模式操作失败：连接未就绪')
    return
  }
  showSuccess(activeGoal.value ? '目标已替换' : '目标已设定，Agent 将朝目标推进')
}

function send(action: 'pause' | 'resume' | 'drop') {
  const ok = props.sendAction(action)
  if (!ok) {
    showError('目标模式操作失败：连接未就绪')
    return
  }
  showSuccess(action === 'pause' ? '目标已暂停' : action === 'resume' ? '目标已恢复' : '目标已放弃')
}
</script>

<style scoped>
.goal-mode-panel {
  border-top: 1px solid var(--border);
  margin-top: 8px;
  padding-top: 8px;
}

.goal-panel-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9em;
  color: var(--text-secondary);
}

.goal-status-badge {
  font-size: 0.72em;
  padding: 1px 8px;
  border-radius: 10px;
  border: 1px solid var(--border);
}

.goal-status--active {
  color: var(--status-ok, #4caf50);
  border-color: var(--status-ok, #4caf50);
}

.goal-status--paused {
  color: var(--status-warn, #e6a23c);
  border-color: var(--status-warn, #e6a23c);
}

.goal-panel-desc {
  margin: 6px 0 0;
  font-size: 0.78em;
  color: var(--text-tertiary);
  line-height: 1.4;
}

.goal-input-row {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.goal-input {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  font-size: 0.82em;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.goal-btn {
  padding: 6px 14px;
  font-size: 0.8em;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
  white-space: nowrap;
}

.goal-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.goal-btn--small {
  padding: 3px 10px;
  font-size: 0.75em;
}

.goal-btn--danger {
  color: var(--status-error, #e05252);
  border-color: color-mix(in srgb, var(--status-error, #e05252) 45%, transparent);
}

.goal-current {
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-primary);
}

.goal-current-text {
  font-size: 0.8em;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.goal-usage {
  margin-top: 4px;
  font-size: 0.7em;
  color: var(--text-tertiary);
}

.goal-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
</style>
