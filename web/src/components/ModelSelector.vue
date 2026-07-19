<template>
  <div class="composer-model-selector">
    <DsSelect
      :model-value="selectedModelId"
      :options="modelOptions"
      placeholder="选择模型"
      aria-label="模型选择器"
      size="sm"
      @update:model-value="onSelectModel"
    >
      <template #option="{ option }">
        <span class="model-option-name">{{ option.label }}</span>
        <span
          v-if="option.contextWindow"
          class="model-option-ctx"
          :title="ctxTooltip(option.contextWindow)"
        >{{ formatCtx(Number(option.contextWindow)) }}</span>
      </template>
    </DsSelect>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useChatInputInjected } from '../composables/useChatInput'
import { useChatStore } from '../stores/chat'
import DsSelect from './ui/DsSelect.vue'

const store = useChatStore()
const chatInput = useChatInputInjected()

const selectedModelId = computed(() => {
  const selected = store.availableModels.find(model =>
    model.provider === chatInput.providerId.value && model.name === chatInput.modelName.value,
  )
  return selected?.id ?? null
})

const modelOptions = computed(() => store.availableModels.map(model => ({
  value: model.id,
  label: `${model.provider} · ${model.name}`,
  providerId: model.provider,
  modelName: model.name,
  contextWindow: model.contextWindow,
})))

/** 将 contextWindow（tokens 数）格式化为人类可读的短标记，如 8k / 128k / 200k */
function formatCtx(tokens: number): string {
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`
  return String(tokens)
}

/** Novice 友好的 contextWindow tooltip：解释「上下文窗口」是什么、约等于多少字 */
function ctxTooltip(raw: unknown): string {
  const tokens = Number(raw)
  if (!Number.isFinite(tokens) || tokens <= 0) return '上下文窗口未知'
  const approxChars = Math.round(tokens * 0.6)
  const charsLabel = approxChars >= 10000
    ? `${Math.round(approxChars / 10000)} 万字`
    : `${approxChars} 字`
  return `上下文窗口：${formatCtx(tokens)}（约 ${charsLabel}）— 模型一次对话能处理的最大文本长度，包括你的输入和 AI 的回复。`
}

function onSelectModel(value: string | number | null) {
  if (value == null) return
  const model = store.availableModels.find(item => item.id === String(value))
  if (!model) return
  store.setModel(model.id)
  chatInput.onModelChange(model.provider, model.name)
}

function syncInitialSelection() {
  const models = store.availableModels
  if (models.length === 0) return

  const selected = models.find(model =>
    model.provider === chatInput.providerId.value && model.name === chatInput.modelName.value,
  ) ?? models.find(model => model.id === store.currentModel || model.name === store.currentModel)

  if (selected) {
    if (selected.provider !== chatInput.providerId.value || selected.name !== chatInput.modelName.value) {
      onSelectModel(selected.id)
    }
    return
  }

  onSelectModel(models[0].id)
}

watch(() => store.availableModels.length, syncInitialSelection, { immediate: true })

onMounted(async () => {
  if (store.availableModels.length === 0) await store.fetchAvailableModels()
  syncInitialSelection()
})
</script>

<style scoped>
.composer-model-selector {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-width: 0;
  max-width: min(240px, 100%);
}

.composer-model-selector :deep(.ds-select) {
  width: min(240px, 100%);
  min-width: 0;
}

.composer-model-selector :deep(.ds-select__input) {
  width: 100%;
  min-width: 0;
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

.composer-model-selector :deep(.ds-select__input:hover) {
  background: var(--bg-secondary, #f9fafb);
}

.composer-model-selector :deep(.ds-select--open .ds-select__input) {
  border-color: var(--accent);
  color: var(--text-primary);
}

.composer-model-selector :deep(.ds-select__caret) {
  width: 20px;
  height: 24px;
  color: var(--text-tertiary, #9ca3af);
}

.composer-model-selector :deep(.ds-select--open .ds-select__caret) {
  color: var(--text-primary);
}

.composer-model-selector :deep(.ds-select__option) {
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

@media (max-width: 480px) {
  .composer-model-selector,
  .composer-model-selector :deep(.ds-select) {
    max-width: 160px;
  }
}
</style>
