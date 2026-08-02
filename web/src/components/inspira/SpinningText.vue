<template>
  <div
    ref="containerRef"
    :class="['spinning-text', { 'spinning-text--ready': ready }, props.class]"
    :style="{ height: `${lineHeight}px` }"
    role="status"
    :aria-label="props.texts[currentIndex]"
  >
    <span
      v-for="(text, index) in props.texts"
      :key="index"
      class="spinning-text-item"
      :class="{
        'is-active': index === currentIndex,
        'is-leaving': index === leavingIndex,
      }"
    >
      {{ text }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'

interface SpinningTextProps {
  texts: string[]
  duration?: number
  class?: string
}

const props = withDefaults(defineProps<SpinningTextProps>(), {
  duration: 3,
})

const TRANSITION_DURATION = 500 // ms

const currentIndex = ref(0)
const leavingIndex = ref<number | null>(null)
const ready = ref(false)
const lineHeight = ref(0)
const containerRef = ref<HTMLElement | null>(null)

let timer: ReturnType<typeof setInterval> | null = null

function advanceText() {
  if (props.texts.length <= 1) return
  leavingIndex.value = currentIndex.value
  currentIndex.value = (currentIndex.value + 1) % props.texts.length

  setTimeout(() => {
    leavingIndex.value = null
  }, TRANSITION_DURATION)
}

function startCycle() {
  if (props.texts.length <= 1) return
  timer = setInterval(advanceText, props.duration * 1000)
}

function stopCycle() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

onMounted(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (reducedMotion) {
    // reduced motion: no animation, just cycle on timer
    ready.value = true
    startCycle()
    return
  }

  // Measure line height from the first rendered item
  nextTick(() => {
    const el = containerRef.value?.querySelector<HTMLElement>('.spinning-text-item')
    if (el) {
      lineHeight.value = el.offsetHeight
    } else {
      lineHeight.value = 24 // fallback
    }
    ready.value = true
    startCycle()
  })
})

onUnmounted(() => {
  stopCycle()
})
</script>

<style scoped>
.spinning-text {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  vertical-align: bottom;
  perspective: 180px;
  min-width: 1px;
}

.spinning-text-item {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  opacity: 0;
  transform: rotateX(-75deg) translateY(-6px);
  /* No transition by default — prevents flash on mount */
}

/* Animate in: hidden → visible */
.spinning-text--ready .spinning-text-item.is-active {
  opacity: 1;
  transform: rotateX(0deg) translateY(0);
  transition: transform 0.45s cubic-bezier(0.34, 1.2, 0.64, 1),
              opacity 0.45s ease;
}

/* Animate out: visible → hidden (bottom) */
.spinning-text--ready .spinning-text-item.is-leaving {
  opacity: 0;
  transform: rotateX(75deg) translateY(6px);
  transition: transform 0.4s ease-in,
              opacity 0.35s ease-in;
}

/* ── prefers-reduced-motion ── */
@media (prefers-reduced-motion: reduce) {
  .spinning-text-item {
    transition: none !important;
  }
  .spinning-text-item.is-active {
    opacity: 1;
    transform: none;
  }
  .spinning-text-item.is-leaving {
    opacity: 0;
    transform: none;
  }
}
</style>