<template>
  <BubbleChrome :tool-call="toolCall">
    <div v-if="toolCall.status === 'running'" class="bubble-running">
      <span class="spinner"></span>
      <span>搜索中...</span>
    </div>
    <div v-else-if="toolCall.status === 'error'" class="bubble-error">
      {{ toolCall.output || '搜索失败' }}
    </div>
    <template v-else-if="toolCall.status === 'done'">
      <div v-if="query" class="search-query">搜索: {{ query }}</div>
      <div v-if="results.length" class="search-results">
        <div v-for="(r, i) in results" :key="i" class="search-item">
          <div v-if="r.title" class="search-title">{{ r.title }}</div>
          <div v-if="r.url" class="search-url">{{ r.url }}</div>
          <div v-if="r.snippet" class="search-snippet">{{ r.snippet }}</div>
        </div>
      </div>
      <div v-if="summary" class="search-summary">{{ summary }}</div>
      <div v-if="!results.length && !summary" class="bubble-empty">{{ fallbackText }}</div>
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

const query = computed(() => (data.value?.query ?? '') as string)
const summary = computed(() => (data.value?.summary ?? data.value?.answer ?? '') as string)
const results = computed(() => {
  const raw = data.value?.results ?? data.value?.items ?? data.value?.pages ?? []
  if (Array.isArray(raw)) return raw as Array<{ title?: string; url?: string; snippet?: string }>
  return []
})

const fallbackText = computed(() => {
  if (props.toolCall.output) {
    const t = props.toolCall.output.length > 500 ? props.toolCall.output.slice(0, 500) + '...' : props.toolCall.output
    return t
  }
  return '搜索完成'
})
</script>

<style scoped>
.bubble-running { display: flex; align-items: center; gap: 8px; padding: 8px 0; font-size: 13px; color: var(--text-secondary); }
.spinner { width: 14px; height: 14px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: maxma-spin 0.6s linear infinite; }
.bubble-error { font-size: 13px; color: var(--error-color, #ef4444); padding: 4px 0; }
.bubble-empty { font-size: 13px; color: var(--text-secondary); padding: 4px 0; }
.search-query { font-size: 13px; font-weight: 500; color: var(--text-primary); margin-bottom: 8px; }
.search-results { display: flex; flex-direction: column; gap: 8px; }
.search-item { padding: 8px; background: var(--bg-secondary); border-radius: 6px; }
.search-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.search-url { font-size: 11px; color: var(--accent); word-break: break-all; margin-top: 2px; }
.search-snippet { font-size: 12px; color: var(--text-secondary); margin-top: 4px; line-height: 1.5; }
.search-summary { font-size: 13px; color: var(--text-primary); margin-top: 8px; padding: 8px; background: var(--bg-secondary); border-radius: 6px; line-height: 1.6; }
</style>
