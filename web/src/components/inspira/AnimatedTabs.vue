<template>
  <div :class="cn('animated-tabs', props.class)" role="tablist">
    <button
      v-for="tab in props.tabs"
      :key="tab.value"
      ref="setTabRef"
      :class="['tab-btn', { active: modelValue === tab.value }]"
      role="tab"
      :aria-selected="modelValue === tab.value"
      @click="emit('update:modelValue', tab.value)"
    >
      {{ tab.label }}
    </button>
    <div
      class="tab-indicator"
      :style="indicatorStyle"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { cn } from '@/lib/utils'

interface Tab {
  label: string
  value: string
}

interface Props {
  tabs: Tab[]
  modelValue: string
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  class: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const tabRefs = ref<Map<string, HTMLElement>>(new Map())

function setTabRef(el: any) {
  if (el) {
    const tab = props.tabs.find((t) => {
      return el.textContent?.trim() === t.label
    })
    if (tab) {
      tabRefs.value.set(tab.value, el as HTMLElement)
    }
  }
}

const indicatorStyle = computed(() => {
  const activeTab = tabRefs.value.get(props.modelValue)
  if (!activeTab) return { opacity: 0 }
  return {
    width: `${activeTab.offsetWidth}px`,
    transform: `translateX(${activeTab.offsetLeft}px)`,
    opacity: 1,
  }
})

function updateIndicator() {
  const activeTab = tabRefs.value.get(props.modelValue)
  if (activeTab) {
    activeTab.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }
}

onMounted(() => {
  nextTick(() => {
    updateIndicator()
  })
})

watch(
  () => props.modelValue,
  () => {
    nextTick(() => {
      updateIndicator()
    })
  },
)
</script>

<style scoped>
.animated-tabs {
  display: flex;
  position: relative;
  gap: 4px;
  padding: 4px;
  border-radius: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  width: fit-content;
}

.tab-btn {
  position: relative;
  z-index: 1;
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.2s ease;
  white-space: nowrap;
  outline: none;
}

.tab-btn:hover {
  color: var(--text-primary);
}

.tab-btn.active {
  color: var(--accent);
}

.tab-btn:focus-visible {
  box-shadow: 0 0 0 2px var(--accent);
}

.tab-indicator {
  position: absolute;
  top: 4px;
  left: 0;
  height: calc(100% - 8px);
  border-radius: 8px;
  background: var(--accent);
  opacity: 0;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.2s ease;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .tab-indicator {
    transition: none;
  }
}
</style>