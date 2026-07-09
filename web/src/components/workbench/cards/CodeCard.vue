<template>
  <div class="canvas-card code-card">
    <div class="card-header">
      <span class="card-icon">&#128187;</span>
      <span class="card-title">{{ card.title }}</span>
      <span v-if="card.sourceTool" class="card-source">{{ card.sourceTool }}</span>
      <button class="card-copy" @click="copyCode" title="复制代码">
        {{ copied ? '✓' : '⎘' }}
      </button>
      <button class="card-remove" @click="$emit('remove')" title="移除">&times;</button>
    </div>
    <pre class="card-code"><code>{{ card.content }}</code></pre>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { CanvasCard } from '@/types/workbench'

const props = defineProps<{ card: CanvasCard }>()
defineEmits<{ remove: [] }>()

const copied = ref(false)

async function copyCode() {
  try {
    await navigator.clipboard.writeText(props.card.content)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch { /* ignore */ }
}
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
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--bg-secondary, #f8f9fa);
}

.card-icon {
  font-size: 14px;
}

.card-title {
  font-size: 13px;
  font-weight: 600;
  flex: 1;
}

.card-source {
  font-size: 10px;
  color: var(--text-secondary, #999);
  background: var(--bg-hover, #f0f0f0);
  padding: 2px 6px;
  border-radius: 4px;
}

.card-copy, .card-remove {
  border: none;
  background: transparent;
  font-size: 14px;
  cursor: pointer;
  color: var(--text-secondary, #999);
  padding: 2px 6px;
  border-radius: 4px;
}

.card-copy:hover, .card-remove:hover {
  background: var(--bg-hover, #f0f0f0);
}

.card-code {
  padding: 12px;
  font-size: 12px;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  overflow-x: auto;
  margin: 0;
  line-height: 1.5;
  color: var(--text-primary, #333);
}
</style>
