<template>
  <div class="model-selector">
    <DsSelect
      :model-value="store.currentModel"
      :options="modelOptions"
      :placeholder="displayName || '选择模型'"
      :aria-label="'模型选择器'"
      :group-key="'provider'"
      size="sm"
      @update:model-value="onSelectModel"
    >
      <template #option="{ option }">
        <span class="model-option-name">{{ option.label }}</span>
        <span
          v-if="option.contextWindow"
          class="model-option-ctx"
          :title="`${option.contextWindow} tokens`"
        >{{ formatCtx(Number(option.contextWindow)) }}</span>
      </template>
    </DsSelect>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useChatStore } from '../stores/chat'
import DsSelect from './ui/DsSelect.vue'

const store = useChatStore()

const displayName = computed(() => {
  const found = store.availableModels.find(m => m.id === store.currentModel)
  return found?.name || ''
})

const modelOptions = computed(() =>
  store.availableModels.map(m => ({
    value: m.id,
    label: m.name,
    provider: m.provider,
    contextWindow: m.contextWindow,
  }))
)

/** 将 contextWindow（tokens 数）格式化为人类可读的短标记，如 8k / 128k / 200k */
function formatCtx(tokens: number): string {
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`
  return String(tokens)
}

function onSelectModel(value: string | number) {
  store.setModel(String(value))
}

onMounted(() => { if (store.availableModels.length === 0) store.fetchAvailableModels() })
</script>

<style scoped>
.model-selector {
  position: relative;
  display: inline-flex;
  align-items: center;
}

/* 覆盖 DsSelect input 样式，使其与原紧凑 trigger 视觉一致 */
.model-selector :deep(.ds-select) {
  width: auto;
}
.model-selector :deep(.ds-select__input) {
  height: 24px;
  padding: 0 24px 0 8px;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #6b7280);
  font-size: 12px;
  font-family: var(--font-body);
  cursor: pointer;
  transition: background var(--duration-fast, 0.15s) var(--ease-out, ease-out),
              border-color var(--duration-fast, 0.15s) var(--ease-out, ease-out);
}
.model-selector :deep(.ds-select__input:hover) {
  background: var(--bg-secondary, #f9fafb);
}
.model-selector :deep(.ds-select--open .ds-select__input) {
  border-color: var(--accent);
  color: var(--text-primary);
}
.model-selector :deep(.ds-select__caret) {
  width: 20px;
  height: 24px;
  color: var(--text-tertiary, #9ca3af);
}
.model-selector :deep(.ds-select--open .ds-select__caret) {
  color: var(--text-primary);
}

/* 选项内容：模型名 + ctx 标记（如 8k / 128k） */
.model-selector :deep(.ds-select__option) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.model-option-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model-option-ctx {
  flex-shrink: 0;
  font-size: 0.85em;
  color: var(--text-tertiary, #9ca3af);
  background: var(--bg-secondary, #f3f4f6);
  padding: 1px 6px;
  border-radius: 100px;
  line-height: 1.4;
  font-variant-numeric: tabular-nums;
}
</style>
