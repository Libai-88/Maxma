<!-- web/src/components/QuotedSelectionCard.vue -->
<template>
  <div class="quoted-card">
    <div class="quoted-card-header">
      <span class="quoted-source">{{ quote.source }}</span>
      <button class="quoted-remove" @click="$emit('remove')" title="移除引用"><Icon name="close" :size="12" /></button>
    </div>
    <div class="quoted-text">{{ quote.text }}</div>
  </div>
</template>

<script setup lang="ts">
import type { QuotedSelection } from '@/composables/useSelectionQuote'
import Icon from '@/components/Icon.vue'

defineProps<{ quote: QuotedSelection }>()
defineEmits<{ remove: [] }>()
</script>

<style scoped>
.quoted-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: 6px;
  padding: 6px 10px;
  max-width: 300px;
  font-size: 0.85em;
}

.quoted-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.quoted-source {
  font-size: 0.75em;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.quoted-remove {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.9em;
  padding: 0 4px;
  border-radius: 3px;
}
.quoted-remove:hover {
  color: var(--status-error);
  background: transparent;
  background: transparent;
  background: color-mix(in srgb, var(--status-error) 10%, transparent);
}

.quoted-text {
  color: var(--text-secondary);
  line-height: 1.5;
  max-height: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
</style>
