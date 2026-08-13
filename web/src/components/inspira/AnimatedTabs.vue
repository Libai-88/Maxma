<template>
  <div :class="cn('animated-tabs', props.class)" role="tablist">
    <button
      v-for="tab in props.tabs"
      :key="tab.value"
      :ref="setTabRef"
      :class="['tab-btn', { active: modelValue === tab.value }]"
      role="tab"
      :aria-selected="modelValue === tab.value"
      @click="emit('update:modelValue', tab.value)"
    >
      {{ tab.label }}
    </button>
    <div
      class="tab-indicator"
      :style="indicator"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, watch, nextTick } from 'vue'
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

// TABS-INDICATOR-001：指示器样式不再用 computed 派生——
// offsetLeft/offsetTop 是布局值而非响应式，v-show 切换 section 引起的
// flex-wrap 重排（滚动条出现/消失改变可用宽度）后 computed 无法感知，
// 指示器会停留在重排前的错误位置（点击第一行末尾 tab 时尤为明显）。
// 改为手动刷新：所有可能改变布局的时机（挂载 / modelValue 变化 /
// 容器滚动 / 窗口 resize）都强制重读布局值。
const indicator = reactive({
  width: '0px',
  height: '0px',
  top: '0px',
  transform: 'translateX(0px)',
  opacity: 0,
})

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

/** 重读激活 tab 的布局值并应用到指示器（非响应式依赖，调用方负责时机） */
function refreshIndicator() {
  const activeTab = tabRefs.value.get(props.modelValue)
  if (!activeTab) {
    indicator.opacity = 0
    return
  }
  indicator.width = `${activeTab.offsetWidth}px`
  indicator.height = `${activeTab.offsetHeight}px`
  indicator.top = `${activeTab.offsetTop}px`
  indicator.transform = `translateX(${activeTab.offsetLeft - scrollLeft.value}px)`
  indicator.opacity = 1
}

function updateIndicator() {
  refreshIndicator()
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
  refreshIndicator()
}

// 窗口 resize 会改变可用宽度 → flex-wrap 重排 → 指示器必须跟随
let resizeObserver: ResizeObserver | null = null

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
    refreshIndicator()
  })
  // 布局观察：容器尺寸变化（含父级滚动条出现导致的宽度收缩）时刷新指示器
  if (typeof ResizeObserver !== 'undefined' && containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      refreshIndicator()
    })
    resizeObserver.observe(containerRef.value)
  }
})

onUnmounted(() => {
  if (containerRef.value) {
    containerRef.value.removeEventListener('scroll', onContainerScroll)
  }
  resizeObserver?.disconnect()
})

watch(
  () => props.modelValue,
  () => {
    // 等两帧：v-show 切换 section 会先改变布局（滚动条出现/消失 →
    // flex-wrap 重排），此时重读 offsetLeft/offsetTop 才是稳定终值
    nextTick(() => {
      updateIndicator()
    })
    requestAnimationFrame(() => {
      updateIndicator()
    })
    setTimeout(() => {
      updateIndicator()
    }, 0)
  },
)
</script>

<style scoped>
.animated-tabs {
  display: flex;
  flex-wrap: wrap;
  position: relative;
  gap: 4px;
  padding: 4px;
  border-radius: 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  width: fit-content;
  max-width: 100%;
  /* TABS-WRAP-001：标签过多时换行展示（设置页 11 个 tab），
     所有标签完整可见，不再横向滚动裁剪 */
  overflow: visible;
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
  left: 0;
  border-radius: 8px;
  background: var(--accent);
  opacity: 0;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              height 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.2s ease;
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .tab-indicator {
    transition: none;
  }
}
</style>