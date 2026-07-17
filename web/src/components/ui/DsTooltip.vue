<!-- web/src/components/ui/DsTooltip.vue -->
<template>
  <Teleport to="body">
    <Transition name="ds-tooltip">
      <div
        v-if="visible"
        ref="tooltipRef"
        class="ds-tooltip"
        :class="`ds-tooltip--${placement}`"
        role="tooltip"
        :id="tooltipId"
      >
        <slot name="content">{{ content }}</slot>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{
  content?: string
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'auto'
  delay?: number
}>(), {
  placement: 'auto',
  delay: 500,
})

const visible = ref(false)
const tooltipRef = ref<HTMLElement | null>(null)
const tooltipId = `tt-${Math.random().toString(36).slice(2, 9)}`
let showTimer: ReturnType<typeof setTimeout> | null = null
let triggerEl: HTMLElement | null = null
let actualPlacement = 'top'

function computePlacement(): 'top' | 'bottom' | 'left' | 'right' {
  if (props.placement !== 'auto') return props.placement
  if (!triggerEl) return 'top'
  const rect = triggerEl.getBoundingClientRect()
  const scores = {
    top: rect.top,
    bottom: window.innerHeight - rect.bottom,
    left: rect.left,
    right: window.innerWidth - rect.right,
  }
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0] as 'top' | 'bottom' | 'left' | 'right'
}

function updatePosition() {
  if (!triggerEl || !tooltipRef.value) return
  actualPlacement = computePlacement()
  const triggerRect = triggerEl.getBoundingClientRect()
  const tipRect = tooltipRef.value.getBoundingClientRect()
  const gap = 8

  const positions: Record<string, { top: number; left: number }> = {
    top: { top: triggerRect.top - tipRect.height - gap, left: triggerRect.left + (triggerRect.width - tipRect.width) / 2 },
    bottom: { top: triggerRect.bottom + gap, left: triggerRect.left + (triggerRect.width - tipRect.width) / 2 },
    left: { top: triggerRect.top + (triggerRect.height - tipRect.height) / 2, left: triggerRect.left - tipRect.width - gap },
    right: { top: triggerRect.top + (triggerRect.height - tipRect.height) / 2, left: triggerRect.right + gap },
  }
  const pos = positions[actualPlacement]
  // CSP-safe CSSOM: was reactive :style tooltipStyle
  tooltipRef.value.style.setProperty('top', `${Math.max(4, Math.min(window.innerHeight - tipRect.height - 4, pos.top))}px`)
  tooltipRef.value.style.setProperty('left', `${Math.max(4, Math.min(window.innerWidth - tipRect.width - 4, pos.left))}px`)
}

function show(e: Event) {
  triggerEl = e.currentTarget as HTMLElement
  if (showTimer) clearTimeout(showTimer)
  showTimer = setTimeout(() => {
    visible.value = true
    nextTick(updatePosition)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
  }, props.delay)
}

function hide() {
  if (showTimer) { clearTimeout(showTimer); showTimer = null }
  visible.value = false
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onScroll)
}

function onScroll() { if (visible.value) updatePosition() }

defineExpose({ show, hide })

onUnmounted(() => {
  if (showTimer) clearTimeout(showTimer)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onScroll)
})
</script>

<style scoped>
.ds-tooltip {
  position: fixed;
  z-index: 9999;
  padding: 4px 10px;
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
  font-size: var(--fs-caption);
  line-height: 1.5;
  max-width: 280px;
  pointer-events: none;
  word-wrap: break-word;
}

.ds-tooltip-enter-active {
  transition: opacity var(--duration-instant) var(--ease-out);
}
.ds-tooltip-leave-active {
  transition: opacity var(--duration-instant) var(--ease-in);
}
.ds-tooltip-enter-from,
.ds-tooltip-leave-to {
  opacity: 0;
}
</style>
