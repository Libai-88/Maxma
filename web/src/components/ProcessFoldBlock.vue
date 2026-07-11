<template>
  <section class="process-fold" :class="toolCall.status">
    <div class="process-fold__summary">
      <div class="process-fold__title-row">
        <span class="process-fold__title">{{ displayName }}</span>
        <span class="process-fold__meta">{{ statusLabel }}</span>
        <span v-if="toolCall.elapsed !== null" class="process-fold__meta">
          {{ toolCall.elapsed.toFixed(1) }}s
        </span>
      </div>
      <p v-if="preview" class="process-fold__preview">{{ preview }}</p>
      <span class="process-fold__metrics">{{ metrics }}</span>
    </div>

    <div class="process-fold__actions">
      <button
        class="process-fold__action"
        type="button"
        :aria-expanded="expanded"
        :aria-controls="contentId"
        @click="toggle"
      >
        {{ expanded ? '收起详情' : '查看详情' }}
      </button>
      <button
        class="process-fold__action"
        type="button"
        :disabled="!rawContent"
        @click="copyRawContent"
      >
        {{ copied ? '已复制' : '复制完整内容' }}
      </button>
    </div>

    <!-- Large tool UIs are created only when the user asks for the details. -->
    <div v-if="expanded" :id="contentId" class="process-fold__details">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ToolCall } from '@/types'
import { toolDisplayName } from './tools/_shared/displayNames'

const props = defineProps<{ toolCall: ToolCall }>()

const expanded = ref(false)
const copied = ref(false)
const contentId = `process-fold-${Math.random().toString(36).slice(2)}`

const displayName = computed(() => toolDisplayName(props.toolCall.name))
const rawContent = computed(() => [props.toolCall.input, props.toolCall.output ?? ''].filter(Boolean).join('\n\n'))
const normalizedContent = computed(() => rawContent.value.replace(/\s+/g, ' ').trim())
const preview = computed(() => {
  const text = normalizedContent.value
  if (!text) return ''
  return text.length > 220 ? `${text.slice(0, 220)}...` : text
})
const lineCount = computed(() => rawContent.value ? rawContent.value.split('\n').length : 0)
const byteCount = computed(() => new TextEncoder().encode(rawContent.value).length)
const metrics = computed(() => `${lineCount.value} 行 · ${formatBytes(byteCount.value)}`)
const statusLabel = computed(() => props.toolCall.status === 'running' ? '执行中' : '已完成')

function toggle() {
  expanded.value = !expanded.value
}

async function copyRawContent() {
  if (!rawContent.value) return
  try {
    await navigator.clipboard.writeText(rawContent.value)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = rawContent.value
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
  }
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 2_000)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<style scoped>
.process-fold {
  margin: 8px 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  background: var(--bg-card);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}
.process-fold__summary {
  padding: 10px 14px 6px;
}
.process-fold__title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.process-fold__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: var(--fs-ui);
  font-weight: 600;
}
.process-fold__meta,
.process-fold__metrics {
  color: var(--text-secondary);
  font-size: var(--fs-hint);
  white-space: nowrap;
}
.process-fold__preview {
  display: -webkit-box;
  margin: 6px 0 5px;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--fs-caption);
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.process-fold__actions {
  display: flex;
  gap: var(--space-8);
  padding: 0 14px 10px;
}
.process-fold__action {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--fs-hint);
}
.process-fold__action:hover:not(:disabled) {
  border-color: var(--text-secondary);
  color: var(--text-primary);
}
.process-fold__action:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.process-fold__action:disabled {
  cursor: not-allowed;
  opacity: .5;
}
.process-fold__details {
  border-top: 1px solid var(--border);
}
</style>
