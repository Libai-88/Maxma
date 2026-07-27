<template>
  <BubbleChrome :tool-call="toolCall">
    <div v-if="toolCall.status === 'running'" class="bubble-running">
      <span class="spinner"></span>
      <span>正在浏览网页...</span>
    </div>
    <div v-else-if="toolCall.status === 'error'" class="bubble-error">
      {{ toolCall.output || '浏览失败' }}
    </div>
    <template v-else-if="toolCall.status === 'done'">
      <div v-if="url" class="browser-header">
        <div class="browser-url">{{ url }}</div>
        <div v-if="title" class="browser-title">{{ title }}</div>
      </div>
      <div v-if="screenshot" class="browser-screenshot">
        <img :src="screenshot" alt="页面截图" @click="expanded = !expanded" :class="{ expanded }" />
      </div>
      <div v-if="content" class="browser-content">
        <pre>{{ content }}</pre>
      </div>
      <div v-if="!url && !content" class="bubble-empty">{{ fallbackText }}</div>
    </template>
  </BubbleChrome>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ToolCall } from '@/types'
import BubbleChrome from './_shared/BubbleChrome.vue'

const props = defineProps<{ toolCall: ToolCall }>()
defineEmits<{ (e: 'action', p: { action: string; data?: unknown }): void }>()

const expanded = ref(false)

const data = computed(() => {
  if (props.toolCall.toolData) return props.toolCall.toolData as Record<string, unknown>
  if (props.toolCall.output) {
    try { return JSON.parse(props.toolCall.output) } catch { /* ignore */ }
  }
  return null
})

const url = computed(() => (data.value?.url ?? data.value?.sourceUrl ?? '') as string)
const title = computed(() => (data.value?.title ?? '') as string)
const screenshot = computed(() => (data.value?.screenshot ?? data.value?.screenshotUrl ?? '') as string)
const content = computed(() => {
  const raw = data.value?.content ?? data.value?.textContent ?? data.value?.markdown
  if (typeof raw === 'string') return raw.slice(0, 2000)
  return ''
})

const fallbackText = computed(() => {
  if (props.toolCall.output) {
    const t = props.toolCall.output.length > 500 ? props.toolCall.output.slice(0, 500) + '...' : props.toolCall.output
    return t
  }
  return '浏览完成'
})
</script>

<style scoped>
.bubble-running { display: flex; align-items: center; gap: 8px; padding: 8px 0; font-size: 13px; color: var(--text-secondary); }
.spinner { width: 14px; height: 14px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: maxma-spin 0.6s linear infinite; }
.bubble-error { font-size: 13px; color: var(--error-color, #ef4444); padding: 4px 0; }
.bubble-empty { font-size: 13px; color: var(--text-secondary); padding: 4px 0; }
.browser-header { margin-bottom: 8px; }
.browser-url { font-size: 11px; color: var(--accent); word-break: break-all; font-family: var(--font-mono); }
.browser-title { font-size: 14px; font-weight: 600; color: var(--text-primary); margin-top: 4px; }
.browser-screenshot { margin: 8px 0; cursor: pointer; }
.browser-screenshot img { max-width: 100%; border-radius: 6px; border: 1px solid var(--border); transition: max-height 0.2s; max-height: 200px; }
.browser-screenshot img.expanded { max-height: none; }
.browser-content { font-size: 12px; color: var(--text-secondary); }
.browser-content pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-family: var(--font-mono); font-size: 0.95em; line-height: 1.5; max-height: 300px; overflow-y: auto; }
</style>
