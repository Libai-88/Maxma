<template>
  <div class="model-selector" @click.stop="toggleOpen">
    <button class="model-trigger">
      <span class="model-icon" v-html="modelIconSvg"></span>
      <span class="model-name">{{ displayName }}</span>
      <span class="model-arrow" :class="{ open: isOpen }">▾</span>
    </button>
    <Teleport to="body">
      <div v-if="isOpen" class="model-dropdown" @click.stop>
        <div class="dropdown-header">
          选择模型
          <button class="close-btn" @click="isOpen = false">✕</button>
        </div>
        <div class="model-list">
          <div v-for="group in groupedModels" :key="group.provider" class="provider-group">
            <div class="provider-label">{{ group.provider }}</div>
            <div v-for="model in group.models" :key="model.id"
              class="model-item" :class="{ active: model.id === store.currentModel }"
              @click="selectModel(model.id)">
              <span class="model-item-name">{{ model.name }}</span>
              <span class="model-item-ctx">{{ formatCtx(model.contextWindow) }}</span>
            </div>
          </div>
          <div v-if="groupedModels.length === 0" class="empty-state">暂无可用模型</div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useChatStore } from '../stores/chat'
import modelIconRaw from '../assets/icons/sidebar/model.svg?raw'

const store = useChatStore()
const isOpen = ref(false)

// 剥掉 <?xml?> 声明，与 Icon.vue 处理方式一致
const modelIconSvg = computed(() => modelIconRaw.replace(/<\?xml[^>]*\?>/, '').trim())

const displayName = computed(() => {
  const found = store.availableModels.find(m => m.id === store.currentModel)
  return found?.name || store.currentModel
})

const groupedModels = computed(() => {
  const groups = new Map<string, typeof store.availableModels>()
  for (const m of store.availableModels) {
    if (!groups.has(m.provider)) groups.set(m.provider, [])
    groups.get(m.provider)!.push(m)
  }
  return Array.from(groups.entries()).map(([provider, models]) => ({ provider, models }))
})

function toggleOpen() { isOpen.value = !isOpen.value }
function selectModel(id: string) { store.setModel(id); isOpen.value = false }
function formatCtx(ctx: number): string { return ctx >= 1000 ? `${(ctx / 1000).toFixed(0)}k` : `${ctx}` }

onMounted(() => { if (store.availableModels.length === 0) store.fetchAvailableModels() })
function onDocumentClick() { isOpen.value = false }
onMounted(() => document.addEventListener('click', onDocumentClick))
onUnmounted(() => document.removeEventListener('click', onDocumentClick))
</script>

<style scoped>
.model-selector { position: relative; display: inline-block; }
.model-trigger { display: flex; align-items: center; gap: 4px; padding: 4px 8px; border: 1px solid var(--border, #e5e7eb); border-radius: 6px; background: transparent; font-size: 12px; color: var(--text-secondary, #6b7280); cursor: pointer; white-space: nowrap; }
.model-trigger:hover { background: var(--bg-secondary, #f9fafb); }
.model-icon { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; line-height: 0; flex-shrink: 0; }
.model-icon :deep(svg) { width: 100%; height: 100%; }
.model-arrow { font-size: 10px; transition: transform 0.2s; }
.model-arrow.open { transform: rotate(180deg); }
.model-dropdown { position: fixed; z-index: 1000; width: 320px; max-height: 400px; background: var(--bg-card, #fff); border: 1px solid var(--border, #e5e7eb); border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); overflow: hidden; display: flex; flex-direction: column; }
.dropdown-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary, #6b7280); border-bottom: 1px solid var(--border, #e5e7eb); }
.close-btn { background: none; border: none; cursor: pointer; color: var(--text-tertiary, #9ca3af); font-size: 14px; }
.model-list { overflow-y: auto; padding: 6px 0; }
.provider-label { padding: 6px 14px 2px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-tertiary, #9ca3af); }
.model-item { display: flex; justify-content: space-between; align-items: center; padding: 7px 14px; cursor: pointer; font-size: 13px; color: var(--text-primary, #1f2937); }
.model-item:hover { background: var(--bg-secondary, #f9fafb); }
.model-item.active { background: color-mix(in srgb, var(--accent) 14%, transparent); color: var(--accent); font-weight: 600; }
.model-item-ctx { font-size: 11px; color: var(--text-tertiary, #9ca3af); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.model-item.active .model-item-ctx { color: var(--text-tertiary); }
.empty-state { padding: 24px; text-align: center; color: var(--text-tertiary, #9ca3af); font-size: 13px; }
</style>
