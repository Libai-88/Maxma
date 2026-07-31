<template>
  <div ref="rootEl" class="plugin-search-bar">
    <div class="search-input-wrapper">
      <input
        v-model="localQuery"
        type="text"
        class="search-input"
        placeholder="搜索插件名称、描述、标签..."
        @input="handleSearch"
      />
      <button v-if="localQuery" class="clear-btn" @click="clearSearch">✕</button>
    </div>
    <div class="filter-controls">
      <select v-model="localCategory" class="filter-select" @change="handleFilter">
        <option value="">所有分类</option>
        <option value="productivity">生产力</option>
        <option value="development">开发工具</option>
        <option value="ai-assistant">AI 助手</option>
        <option value="integration">集成</option>
        <option value="utility">实用工具</option>
        <option value="other">其他</option>
      </select>
      <select v-model="localEnabled" class="filter-select" @change="handleFilter">
        <option value="">全部状态</option>
        <option value="true">已启用</option>
        <option value="false">已禁用</option>
      </select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { PluginCategory } from '@/types/plugin'
import { gsap, useGsap, easeMap } from '@/composables/useGsap'

const rootEl = ref<HTMLElement | null>(null)

// 搜索栏入场：整体轻微下滑放大，筛选控件随后浮现
useGsap((_ctx) => {
  const el = rootEl.value
  if (!el) return
  const q = gsap.utils.selector(el)
  gsap.timeline({ defaults: { ease: easeMap.out } })
    .from(el, { opacity: 0, y: -10, scale: 0.985, duration: 0.35 })
    .from(q('.filter-controls'), { opacity: 0, y: -6, duration: 0.3 }, '<0.08')
})

const emit = defineEmits<{
  search: [query: string, category: PluginCategory | undefined, enabled: boolean | undefined]
}>()

const localQuery = ref('')
const localCategory = ref<string>('')
const localEnabled = ref<string>('')

function handleSearch() {
  emitFilter()
}

function handleFilter() {
  emitFilter()
}

function emitFilter() {
  emit(
    'search',
    localQuery.value,
    (localCategory.value || undefined) as PluginCategory | undefined,
    localEnabled.value === '' ? undefined : localEnabled.value === 'true'
  )
}

function clearSearch() {
  localQuery.value = ''
  emitFilter()
}
</script>

<style scoped>
.plugin-search-bar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.search-input-wrapper {
  position: relative;
  flex: 1;
}

.search-input {
  width: 100%;
  padding: 10px 36px 10px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.9em;
}

.search-input:focus {
  outline: none;
  border-color: var(--accent);
}

.clear-btn {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.9em;
}

.clear-btn:hover {
  color: var(--text-primary);
}

.filter-controls {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.filter-select {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.85em;
  cursor: pointer;
}

.filter-select:focus {
  outline: none;
  border-color: var(--accent);
}
</style>
