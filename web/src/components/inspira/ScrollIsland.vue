<template>
  <div
    :class="['scroll-island', props.class, { 'scroll-island--visible': visible }]"
    ref="rootEl"
    role="navigation"
    :aria-label="props.title"
  >
    <div class="scroll-island-inner">
      <div class="scroll-island-header">
        <span class="scroll-island-title">{{ props.title }}</span>
      </div>
      <div class="scroll-island-links">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

interface ScrollIslandProps {
  title: string
  class?: string
}

const props = defineProps<ScrollIslandProps>()

const rootEl = ref<HTMLElement | null>(null)
const visible = ref(false)

const SCROLL_THRESHOLD = 300

function onScroll() {
  visible.value = window.scrollY > SCROLL_THRESHOLD
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
})
</script>

<style scoped>
.scroll-island {
  position: fixed;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%) translateY(20px);
  z-index: 1000;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.4s var(--ease-smooth),
    transform 0.4s var(--ease-smooth);
}

.scroll-island--visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
  pointer-events: auto;
}

.scroll-island-inner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: var(--glass-fill, color-mix(in srgb, var(--bg-card) 92%, var(--accent) 3%));
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--border);
  border-radius: 100px;
  box-shadow: var(--shadow-lg);
}

.scroll-island-header {
  display: flex;
  align-items: center;
}

.scroll-island-title {
  font-size: var(--fs-caption);
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
}

.scroll-island-links {
  display: flex;
  align-items: center;
  gap: 4px;
}

@media (prefers-reduced-motion: reduce) {
  .scroll-island {
    transition: none;
  }

  .scroll-island--visible {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}
</style>