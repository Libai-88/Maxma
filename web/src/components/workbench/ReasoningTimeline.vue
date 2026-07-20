<template>
  <div class="reasoning-timeline">
    <div v-if="entries.length === 0" class="timeline-empty">
      <Icon class="empty-icon" name="sparkles" :size="18" />
      <p>暂无推理记录</p>
      <p class="empty-hint">发送消息后显示推理与工具活动</p>
    </div>
    <div v-else class="timeline-list">
      <div
        v-for="entry in entries"
        :key="entry.id"
        class="timeline-item"
        :class="entry.kind"
      >
        <div class="timeline-dot" :class="entry.kind">
          <Icon v-if="entry.kind === 'thinking'" name="chat" :size="12" />
          <Icon v-else-if="entry.kind === 'tool' && entry.status === 'done'" name="checkmark" :size="12" />
          <Icon v-else-if="entry.kind === 'tool' && entry.status === 'error'" name="close" :size="12" />
          <span v-else-if="entry.kind === 'tool' && entry.status === 'running'" class="dot-spinner"></span>
          <Icon v-else-if="entry.kind === 'tool'" name="tool" :size="12" />
          <Icon v-else-if="entry.kind === 'answer'" name="chat" :size="12" />
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
import { useWorkbenchStore } from '@/stores/workbench'
import Icon from '@/components/Icon.vue'

const props = defineProps<{
  turns: ChatTurn[]
}>()

const workbench = useWorkbenchStore()

const entries = computed(() => workbench.buildReasoningTimeline(props.turns))

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
</script>

<style scoped>
.reasoning-timeline {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 100%;
}

.timeline-empty {
  text-align: center;
  padding: 28px 12px;
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
  min-width: 0;
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
  animation: maxma-spin 0.8s linear infinite;
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
  overflow-wrap: anywhere;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
