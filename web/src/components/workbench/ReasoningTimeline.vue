<template>
  <div class="reasoning-timeline">
    <div v-if="entries.length === 0" class="timeline-empty">
      <span class="empty-icon">&#128161;</span>
      <p>暂无推理记录</p>
      <p class="empty-hint">与 Agent 对话后，这里会显示思考链路和工具调用时间线</p>
    </div>
    <div v-else class="timeline-list">
      <div
        v-for="entry in entries"
        :key="entry.id"
        class="timeline-item"
        :class="entry.kind"
      >
        <div class="timeline-dot" :class="entry.kind">
          <span v-if="entry.kind === 'thinking'">&#128173;</span>
          <span v-else-if="entry.kind === 'tool' && entry.status === 'done'">&#10003;</span>
          <span v-else-if="entry.kind === 'tool' && entry.status === 'error'">&#10007;</span>
          <span v-else-if="entry.kind === 'tool' && entry.status === 'running'" class="dot-spinner"></span>
          <span v-else-if="entry.kind === 'tool'">&#128295;</span>
          <span v-else-if="entry.kind === 'answer'">&#128172;</span>
        </div>
        <div class="timeline-content">
          <div class="timeline-header">
            <span class="timeline-label" v-if="entry.kind === 'thinking'">思考</span>
            <span class="timeline-label" v-else-if="entry.kind === 'tool'">{{ entry.toolName || '工具' }}</span>
            <span class="timeline-label" v-else-if="entry.kind === 'answer'">回答</span>
            <span v-if="entry.elapsed != null" class="timeline-elapsed">{{ formatElapsed(entry.elapsed) }}</span>
            <span v-if="entry.status === 'running'" class="timeline-status running">运行中</span>
            <span v-if="entry.status === 'error'" class="timeline-status error">失败</span>
          </div>
          <div class="timeline-text">{{ entry.label }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ChatTurn } from '@/types'
import { useWorkbench } from '@/composables/useWorkbench'

const props = defineProps<{
  turns: ChatTurn[]
}>()

const workbench = useWorkbench()

const entries = computed(() => workbench.buildReasoningTimeline(props.turns))

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
</script>

<style scoped>
.reasoning-timeline {
  min-height: 100%;
}

.timeline-empty {
  text-align: center;
  padding: 60px 16px;
  color: var(--text-secondary, #999);
}

.empty-icon {
  font-size: 32px;
  display: block;
  margin-bottom: 12px;
}

.empty-hint {
  font-size: 12px;
  margin-top: 8px;
  opacity: 0.7;
}

.timeline-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.timeline-item {
  display: flex;
  gap: 10px;
  padding: 8px 0;
  position: relative;
}

/* 连接线 */
.timeline-item:not(:last-child)::before {
  content: '';
  position: absolute;
  left: 11px;
  top: 28px;
  bottom: -8px;
  width: 2px;
  background: var(--border-color, #e0e0e0);
}

.timeline-dot {
  width: 24px;
  height: 24px;
  min-width: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  background: var(--bg-primary, #fff);
  border: 2px solid var(--border-color, #e0e0e0);
  z-index: 1;
}

.timeline-dot.thinking {
  border-color: var(--accent-color, #1a73e8);
  background: var(--accent-bg, #e8f0fe);
}

.timeline-dot.tool {
  border-color: var(--success-color, #34a853);
}

.timeline-dot.answer {
  border-color: var(--warning-color, #f9ab00);
  background: var(--warning-bg, #fef7e0);
}

.dot-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--border-color, #ccc);
  border-top-color: var(--accent-color, #1a73e8);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.timeline-content {
  flex: 1;
  min-width: 0;
}

.timeline-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.timeline-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #333);
}

.timeline-elapsed {
  font-size: 11px;
  color: var(--text-secondary, #999);
}

.timeline-status.running {
  font-size: 10px;
  color: var(--accent-color, #1a73e8);
  font-weight: 600;
}

.timeline-status.error {
  font-size: 10px;
  color: var(--error-color, #ea4335);
  font-weight: 600;
}

.timeline-text {
  font-size: 12px;
  color: var(--text-secondary, #666);
  line-height: 1.4;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
