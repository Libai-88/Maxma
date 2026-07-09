<template>
  <Transition name="workbench-slide">
    <div v-if="isOpen" class="workbench-panel">
      <div class="workbench-header">
        <div class="workbench-tabs">
          <button
            class="workbench-tab"
            :class="{ active: activeTab === 'reasoning' }"
            @click="$emit('set-tab', 'reasoning')"
          >
            推理
          </button>
          <button
            class="workbench-tab"
            :class="{ active: activeTab === 'canvas' }"
            @click="$emit('set-tab', 'canvas')"
          >
            画布
            <span v-if="cardCount > 0" class="tab-badge">{{ cardCount }}</span>
          </button>
        </div>
        <button class="workbench-close" @click="$emit('close')" title="关闭面板">
          &times;
        </button>
      </div>
      <div class="workbench-body">
        <slot name="reasoning" v-if="activeTab === 'reasoning'"></slot>
        <slot name="canvas" v-if="activeTab === 'canvas'"></slot>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import type { WorkbenchTab } from '@/types/workbench'

defineProps<{
  isOpen: boolean
  activeTab: WorkbenchTab
  cardCount: number
}>()

defineEmits<{
  close: []
  'set-tab': [tab: WorkbenchTab]
}>()
</script>

<style scoped>
.workbench-panel {
  width: 380px;
  min-width: 380px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary, #f8f9fa);
  border-left: 1px solid var(--border-color, #e0e0e0);
  overflow: hidden;
}

.workbench-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 44px;
  min-height: 44px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  background: var(--bg-primary, #fff);
}

.workbench-tabs {
  display: flex;
  gap: 4px;
}

.workbench-tab {
  padding: 6px 14px;
  border: none;
  background: transparent;
  color: var(--text-secondary, #666);
  font-size: 13px;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 4px;
}

.workbench-tab:hover {
  background: var(--bg-hover, #f0f0f0);
}

.workbench-tab.active {
  background: var(--accent-bg, #e8f0fe);
  color: var(--accent-color, #1a73e8);
  font-weight: 600;
}

.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  font-size: 10px;
  font-weight: 700;
  border-radius: 8px;
  background: var(--accent-color, #1a73e8);
  color: #fff;
}

.workbench-close {
  border: none;
  background: transparent;
  font-size: 20px;
  color: var(--text-secondary, #666);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  line-height: 1;
}

.workbench-close:hover {
  background: var(--bg-hover, #f0f0f0);
}

.workbench-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

/* 滑入/滑出动画 */
.workbench-slide-enter-active,
.workbench-slide-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}

.workbench-slide-enter-from,
.workbench-slide-leave-to {
  transform: translateX(100%);
  opacity: 0;
}
</style>
