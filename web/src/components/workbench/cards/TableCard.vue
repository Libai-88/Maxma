<template>
  <div class="canvas-card table-card">
    <div class="card-header">
      <span class="card-title">{{ card.title }}</span>
      <button class="card-remove" @click="$emit('remove')">&times;</button>
    </div>
    <div class="card-body" v-html="renderedTable"></div>
  </div>
</template>

<script setup lang="ts">
import type { CanvasCard } from '@/types/workbench'
import { computed } from 'vue'

const props = defineProps<{ card: CanvasCard }>()
defineEmits<{ remove: [] }>()

const renderedTable = computed(() => {
  try {
    const data = JSON.parse(props.card.content)
    if (Array.isArray(data) && data.length > 0) {
      const headers = Object.keys(data[0])
      const rows = data.map((row: Record<string, unknown>) => headers.map(h => String(row[h] ?? '')))
      const thead = headers.map(h => `<th>${h}</th>`).join('')
      const tbody = rows.map((r: string[]) => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')
      return `<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`
    }
  } catch { /* not JSON */ }
  return `<pre>${props.card.content}</pre>`
})
</script>

<style scoped>
.canvas-card {
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 8px;
  overflow: hidden;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--bg-secondary, #f8f9fa);
}

.card-title {
  font-size: 13px;
  font-weight: 600;
}

.card-remove {
  border: none;
  background: transparent;
  font-size: 16px;
  cursor: pointer;
  color: var(--text-secondary, #999);
  padding: 2px 6px;
  border-radius: 4px;
}

.card-remove:hover {
  background: var(--bg-hover, #f0f0f0);
}

.card-body {
  padding: 12px;
  font-size: 12px;
  overflow-x: auto;
}

.card-body :deep(table) {
  border-collapse: collapse;
  width: 100%;
}

.card-body :deep(th),
.card-body :deep(td) {
  border: 1px solid var(--border-color, #e0e0e0);
  padding: 4px 8px;
  text-align: left;
}
</style>
