<template>
  <div class="canvas-card summary-card">
    <div class="card-header">
      <span class="card-title">{{ card.title }}</span>
      <button class="card-remove" @click="$emit('remove')">&times;</button>
    </div>
    <div class="card-body">{{ card.content }}</div>
  </div>
</template>

<script setup lang="ts">
import type { CanvasCard } from '@/types/workbench'

defineProps<{ card: CanvasCard }>()
defineEmits<{ remove: [] }>()
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
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
}
</style>
