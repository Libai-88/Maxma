<template>
  <Teleport to="body">
    <Transition name="workbench">
      <div v-if="isOpen" class="workbench-root" data-workbench-root>
        <button class="workbench-scrim" type="button" aria-label="关闭工作台" @click="emit('close')"></button>
        <aside
          ref="panelRef"
          class="workbench-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workbench-title"
          tabindex="-1"
          @keydown="handleKeydown"
        >
          <div class="workbench-header">
            <div class="workbench-heading">
              <span id="workbench-title" class="workbench-title">工作台</span>
              <div class="workbench-tabs" role="tablist" aria-label="工作台视图">
                <button
                  id="workbench-tab-reasoning"
                  class="workbench-tab"
                  :class="{ active: activeTab === 'reasoning' }"
                  role="tab"
                  :aria-selected="activeTab === 'reasoning'"
                  aria-controls="workbench-panel-body"
                  type="button"
                  @click="emit('set-tab', 'reasoning')"
                >
                  推理
                </button>
                <button
                  id="workbench-tab-canvas"
                  class="workbench-tab"
                  :class="{ active: activeTab === 'canvas' }"
                  role="tab"
                  :aria-selected="activeTab === 'canvas'"
                  aria-controls="workbench-panel-body"
                  type="button"
                  @click="emit('set-tab', 'canvas')"
                >
                  画布
                  <span v-if="cardCount > 0" class="tab-badge">{{ cardCount }}</span>
                </button>
              </div>
            </div>
            <button class="workbench-close" type="button" aria-label="关闭工作台" title="关闭面板" @click="emit('close')">
              &times;
            </button>
          </div>
          <div id="workbench-panel-body" class="workbench-body" role="tabpanel" :aria-labelledby="`workbench-tab-${activeTab}`">
            <slot name="reasoning" v-if="activeTab === 'reasoning'"></slot>
            <slot name="canvas" v-if="activeTab === 'canvas'"></slot>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { WorkbenchTab } from '@/types/workbench'

const props = defineProps<{
  isOpen: boolean
  activeTab: WorkbenchTab
  cardCount: number
}>()

const emit = defineEmits<{
  close: []
  'set-tab': [tab: WorkbenchTab]
}>()

const panelRef = ref<HTMLElement | null>(null)
let previouslyFocused: HTMLElement | null = null

watch(() => props.isOpen, async (isOpen) => {
  if (isOpen) {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    await nextTick()
    panelRef.value?.focus()
  } else if (previouslyFocused && document.contains(previouslyFocused)) {
    previouslyFocused.focus()
    previouslyFocused = null
  }
}, { immediate: true })

function focusableElements() {
  return Array.from(panelRef.value?.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  ) ?? []).filter(element => !element.hasAttribute('disabled') && element.offsetParent !== null)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return

  const elements = focusableElements()
  if (elements.length === 0) {
    event.preventDefault()
    panelRef.value?.focus()
    return
  }

  const first = elements[0]
  const last = elements[elements.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

onBeforeUnmount(() => {
  if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus()
})
</script>

<style scoped>
.workbench-root {
  position: fixed;
  z-index: 1200;
  inset: 0;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  display: flex;
  justify-content: flex-end;
  pointer-events: none;
}

.workbench-scrim {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: color-mix(in srgb, #000 26%, transparent);
  cursor: default;
  pointer-events: auto;
}

.workbench-panel {
  position: relative;
  z-index: 1;
  width: min(var(--workbench-width, 420px), 100%);
  max-width: 100%;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  pointer-events: auto;
  outline: none;
}

.workbench-header {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  max-width: 100%;
  justify-content: space-between;
  padding: 10px 12px 8px 16px;
  min-height: 58px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-primary);
}

.workbench-heading {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
  overflow: hidden;
}

.workbench-title {
  flex: 0 0 auto;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
}

.workbench-tabs {
  display: flex;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.workbench-tab {
  min-height: 32px;
  padding: 5px 10px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 4px;
}

.workbench-tab:hover {
  background: var(--bg-secondary);
}

.workbench-tab.active {
  background: var(--bg-card);
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-card));
  color: var(--accent);
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
  background: var(--accent);
  color: var(--bg-primary);
}

.workbench-close {
  flex: 0 0 auto;
  width: var(--touch-target-min, 44px);
  min-width: var(--touch-target-min, 44px);
  height: var(--touch-target-min, 44px);
  min-height: var(--touch-target-min, 44px);
  border: none;
  background: transparent;
  font-size: 20px;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  line-height: 1;
}

.workbench-close:hover {
  background: var(--bg-secondary);
}

.workbench-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 14px 16px 20px;
}

.workbench-enter-active,
.workbench-leave-active {
  transition: opacity 0.2s ease;
}

.workbench-enter-active .workbench-scrim,
.workbench-leave-active .workbench-scrim {
  transition: opacity 0.2s ease;
}

.workbench-enter-active .workbench-panel,
.workbench-leave-active .workbench-panel {
  transition: transform 0.24s ease;
}

.workbench-enter-from,
.workbench-leave-to {
  opacity: 0;
}

.workbench-enter-from .workbench-scrim,
.workbench-leave-to .workbench-scrim {
  opacity: 0;
}

.workbench-enter-from .workbench-panel,
.workbench-leave-to .workbench-panel {
  transform: translateX(100%);
}

@media (max-width: 767px) {
  .workbench-root {
    align-items: flex-end;
    justify-content: center;
  }

  .workbench-panel {
    width: 100%;
    max-width: 100%;
    height: min(82dvh, 720px);
    max-height: calc(100dvh - 12px);
    border-top: 1px solid var(--border);
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: 12px 12px 0 0;
  }

  .workbench-enter-from .workbench-panel,
  .workbench-leave-to .workbench-panel {
    transform: translateY(100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .workbench-enter-active,
  .workbench-leave-active,
  .workbench-enter-active .workbench-scrim,
  .workbench-leave-active .workbench-scrim,
  .workbench-enter-active .workbench-panel,
  .workbench-leave-active .workbench-panel {
    transition: none;
  }
}
</style>
