<template>
  <div v-if="tabs.length" class="canvas-tabs" role="tablist" aria-label="画布文档">
    <div class="canvas-tabs-scroll">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="canvas-tab"
        :class="{ active: tab.cardId === activeCardId }"
        role="tab"
        :aria-selected="tab.cardId === activeCardId"
        :tabindex="tab.cardId === activeCardId ? 0 : -1"
        :title="tab.title"
        @click="$emit('select', tab.cardId)"
        @keydown.enter.prevent="$emit('select', tab.cardId)"
        @keydown.space.prevent="$emit('select', tab.cardId)"
      >
        <span class="canvas-tab-kind">{{ typeLabel(tab.type) }}</span>
        <span class="canvas-tab-title">{{ tab.title }}</span>
        <span v-if="tab.pinned" class="canvas-tab-pinned" aria-label="已固定">●</span>
        <span class="canvas-tab-actions" @click.stop>
          <button
            class="canvas-tab-action"
            type="button"
            :aria-label="tab.pinned ? `取消固定 ${tab.title}` : `固定 ${tab.title}`"
            :title="tab.pinned ? '取消固定（关闭后不再恢复）' : '固定到工作区'"
            @click="$emit('toggle-pin', tab.cardId)"
          >
            {{ tab.pinned ? '取消固定' : '固定' }}
          </button>
          <button
            class="canvas-tab-action canvas-tab-close"
            type="button"
            :aria-label="`关闭 ${tab.title}`"
            title="关闭"
            @click="$emit('close', tab.cardId)"
          >×</button>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CanvasWorkspaceTab, CanvasCardType } from '@/types/workbench'

defineProps<{
  tabs: CanvasWorkspaceTab[]
  activeCardId: string | null
}>()

defineEmits<{
  select: [cardId: string]
  'toggle-pin': [cardId: string]
  close: [cardId: string]
}>()

function typeLabel(type: CanvasCardType): string {
  return ({ code: '代码', html: 'HTML', json: 'JSON', markdown: 'MD', table: '表格', summary: '摘要', confirmation: '确认', choice: '选项' })[type]
}
</script>

<style scoped>
.canvas-tabs { border-bottom: 1px solid var(--border-color, #e0e0e0); margin-bottom: 12px; }
.canvas-tabs-scroll { display: flex; min-width: min-content; overflow-x: auto; scrollbar-width: thin; }
.canvas-tab { appearance: none; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--text-secondary, #666); cursor: pointer; display: flex; gap: 6px; align-items: center; max-width: 220px; min-height: 34px; padding: 0 8px; white-space: nowrap; }
.canvas-tab:hover { background: var(--bg-hover, #f4f4f4); color: var(--text-primary, #222); }
.canvas-tab.active { border-bottom-color: var(--accent, #2563eb); color: var(--text-primary, #222); }
.canvas-tab:focus-visible, .canvas-tab-action:focus-visible { outline: 2px solid var(--accent, #2563eb); outline-offset: -2px; }
.canvas-tab-kind { font-size: 10px; opacity: .7; }
.canvas-tab-title { overflow: hidden; text-overflow: ellipsis; font-size: 12px; }
.canvas-tab-pinned { color: var(--accent, #2563eb); font-size: 8px; }
.canvas-tab-actions { display: none; align-items: center; gap: 2px; }
.canvas-tab:hover .canvas-tab-actions, .canvas-tab:focus-within .canvas-tab-actions { display: inline-flex; }
.canvas-tab-action { border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 10px; padding: 2px 3px; }
.canvas-tab-action:hover { background: var(--border-color, #ddd); border-radius: 3px; }
.canvas-tab-close { font-size: 16px; line-height: 1; }
@media (prefers-reduced-motion: no-preference) { .canvas-tab { transition: color 150ms ease, background-color 150ms ease, border-color 150ms ease; } }
</style>
