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
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
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
const containerRef = ref<HTMLElement | null>(null)
// 容器横向滚动量，用 ref 包起来以便响应式系统在 scroll 时重新计算 indicator
const scrollLeft = ref(0)

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
  // offsetLeft 是相对 offsetParent 的，但我们的容器没有 positioned 祖先，
  // 所以 offsetLeft 实际相对的是 body / 文档；横向滚动后必须减去 scrollLeft
  // 才能得到"相对容器原点的偏移"，避免 indicator 偏出可见区域。
  if (!activeTab) return { opacity: 0 }
  return {
    width: `${activeTab.offsetWidth}px`,
    transform: `translateX(${activeTab.offsetLeft - scrollLeft.value}px)`,
    opacity: 1,
  }
})

function updateIndicator() {
  const activeTab = tabRefs.value.get(props.modelValue)
  if (activeTab) {
    // 容器可滚动时把激活项 "滚到视野里"，避免横向滚动到末尾后指示器错位
    activeTab.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }
}

function onContainerScroll() {
  if (containerRef.value) {
    scrollLeft.value = containerRef.value.scrollLeft
  }
}

onMounted(() => {
  // 通过任意一个 tab 按钮回溯找到容器，避开页面多实例时的 querySelector 取错问题
  const firstTab = tabRefs.value.values().next().value as HTMLElement | undefined
  if (firstTab) {
    const root = firstTab.closest('[role="tablist"]') as HTMLElement | null
    containerRef.value = root
    if (root) {
      root.addEventListener('scroll', onContainerScroll, { passive: true })
      scrollLeft.value = root.scrollLeft
    }
  }
  nextTick(() => {
    updateIndicator()
  })
})

onUnmounted(() => {
  if (containerRef.value) {
    containerRef.value.removeEventListener('scroll', onContainerScroll)
  }
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
  max-width: 100%;
  /* 标签过多时支持横向滚动，避免被父容器裁掉（设置页 10 个 tab 时尤为明显） */
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-gutter: stable;
}
.animated-tabs::-webkit-scrollbar {
  height: 4px;
}
.animated-tabs::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 2px;
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
  /* 滚动容器内防止按钮被挤压，确保每个 tab 显示完整 */
  flex-shrink: 0;
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