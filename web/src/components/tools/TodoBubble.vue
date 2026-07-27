<template>
  <BubbleChrome :tool-call="toolCall">
    <div v-if="toolCall.status === 'running'" class="bubble-running">
      <span class="spinner"></span>
      <span>处理待办...</span>
    </div>
    <div v-else-if="toolCall.status === 'error'" class="bubble-error">
      {{ toolCall.output || '操作失败' }}
    </div>
    <template v-else-if="toolCall.status === 'done'">
      <div v-if="todos.length" class="todo-list">
        <div class="todo-stats">共 {{ todos.length }} 项</div>
        <div v-for="(t, i) in todos" :key="i" class="todo-item" :class="{ done: t.status === 'completed' || t.done }">
          <span class="todo-checkbox">{{ t.status === 'completed' || t.done ? '✓' : '○' }}</span>
          <span class="todo-text">{{ t.content ?? t.text ?? t.title ?? '' }}</span>
          <span v-if="t.priority" class="todo-priority" :class="`pri-${t.priority}`">{{ t.priority }}</span>
        </div>
      </div>
      <div v-else-if="message" class="todo-result">{{ message }}</div>
      <div v-else class="bubble-empty">{{ fallbackText }}</div>
    </template>
  </BubbleChrome>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ToolCall } from '@/types'
import BubbleChrome from './_shared/BubbleChrome.vue'

const props = defineProps<{ toolCall: ToolCall }>()
defineEmits<{ (e: 'action', p: { action: string; data?: unknown }): void }>()

const data = computed(() => {
  if (props.toolCall.toolData) return props.toolCall.toolData as Record<string, unknown>
  if (props.toolCall.output) {
    try { return JSON.parse(props.toolCall.output) } catch { /* ignore */ }
  }
  return null
})

const todos = computed(() => {
  const raw = data.value?.todos ?? data.value?.items ?? data.value?.tasks ?? []
  if (Array.isArray(raw)) return raw as Array<{ content?: string; text?: string; title?: string; status?: string; done?: boolean; priority?: string }>
  return []
})

const message = computed(() => {
  const m = data.value?.message ?? data.value?.status ?? data.value?.result ?? ''
  return typeof m === 'string' ? m : ''
})

const fallbackText = computed(() => {
  if (props.toolCall.output) {
    const t = props.toolCall.output.length > 500 ? props.toolCall.output.slice(0, 500) + '...' : props.toolCall.output
    return t
  }
  return '操作完成'
})
</script>

<style scoped>
.bubble-running { display: flex; align-items: center; gap: 8px; padding: 8px 0; font-size: 13px; color: var(--text-secondary); }
.spinner { width: 14px; height: 14px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: maxma-spin 0.6s linear infinite; }
.bubble-error { font-size: 13px; color: var(--error-color, #ef4444); padding: 4px 0; }
.bubble-empty { font-size: 13px; color: var(--text-secondary); padding: 4px 0; }
.todo-list { display: flex; flex-direction: column; gap: 4px; max-height: 300px; overflow-y: auto; }
.todo-stats { font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; font-weight: 500; }
.todo-item { display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px; background: var(--bg-secondary); border-radius: 6px; font-size: 13px; }
.todo-item.done { opacity: 0.6; }
.todo-checkbox { flex-shrink: 0; width: 16px; text-align: center; color: var(--accent); }
.todo-item.done .todo-checkbox { color: #22c55e; }
.todo-text { flex: 1; color: var(--text-primary); word-break: break-word; }
.todo-item.done .todo-text { text-decoration: line-through; color: var(--text-tertiary); }
.todo-priority { font-size: 10px; padding: 1px 6px; border-radius: 4px; text-transform: uppercase; }
.pri-high { background: rgba(239,68,68,0.1); color: #ef4444; }
.pri-medium { background: rgba(245,158,11,0.1); color: #f59e0b; }
.pri-low { background: rgba(34,197,94,0.1); color: #22c55e; }
.todo-result { font-size: 13px; color: var(--text-primary); padding: 4px 0; }
</style>
