<template>
  <!-- GAP-B1-001：目标状态只读展示。操作统一走 /goal 命令（/goal <目标>、
       /goal pause|resume|drop）——移除操作按钮，避免入口分散。 -->
  <div class="goal-status-line" role="status" aria-label="目标模式状态">
    <span class="goal-status-dot" :class="statusClass"></span>
    <span class="goal-status-text" :title="goal.objective">{{ goal.objective }}</span>
    <span class="goal-status-badge">{{ statusLabel }}</span>
    <span v-if="goal.tokenBudget" class="goal-status-usage">{{ goal.tokensUsed ?? 0 }}/{{ goal.tokenBudget }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { GoalChannelState } from '@/stores/chat'

const props = defineProps<{
  goal: NonNullable<GoalChannelState['goal']>
}>()

const STATUS_LABELS: Record<string, string> = {
  active: '推进中',
  paused: '已暂停',
  complete: '已完成',
  dropped: '已放弃',
  'budget-limited': '预算受限',
}
const statusLabel = computed(() => STATUS_LABELS[props.goal.status] ?? props.goal.status)
const statusClass = computed(() => `goal-status-dot--${props.goal.status}`)
</script>

<style scoped>
.goal-status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 2px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-primary);
  font-size: 0.78em;
  min-width: 0;
}

.goal-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-tertiary);
  flex-shrink: 0;
}

.goal-status-dot--active {
  background: var(--status-ok, #4caf50);
}

.goal-status-dot--paused {
  background: var(--status-warn, #e6a23c);
}

.goal-status-text {
  flex: 1;
  min-width: 0;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.goal-status-badge {
  flex-shrink: 0;
  font-size: 0.85em;
  color: var(--text-secondary);
}

.goal-status-usage {
  flex-shrink: 0;
  font-size: 0.85em;
  color: var(--text-tertiary);
}
</style>
