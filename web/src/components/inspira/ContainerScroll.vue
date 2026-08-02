<template>
  <div
    ref="containerRef"
    :class="['container-scroll', props.class]"
  >
    <div class="sticky-content">
      <div class="title-section" :style="titleStyle">
        <slot name="title" />
      </div>
      <div class="card-section" :style="cardStyle">
        <slot name="card" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  class?: string
}>()

const containerRef = ref<HTMLElement | null>(null)
const progress = ref(0)
const reducedMotion = ref(false)

const cardStyle = computed(() => {
  if (reducedMotion.value) {
    return { transform: 'none' }
  }
  const p = progress.value
  const scale = 0.8 + p * 0.2
  const translateY = (1 - p) * 200
  return {
    transform: `perspective(800px) scale(${scale}) translateY(${translateY}px)`,
  }
})

const titleStyle = computed(() => {
  if (reducedMotion.value) {
    return { transform: 'none' }
  }
  const p = progress.value
  const translateY = p * -120
  return {
    transform: `translateY(${translateY}px)`,
    opacity: 1 - p * 0.4,
  }
})

function updateProgress() {
  if (!containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  const viewportHeight = window.innerHeight
  const containerHeight = rect.height
  const scrollableDistance = containerHeight - viewportHeight

  if (scrollableDistance <= 0) {
    progress.value = 1
    return
  }

  progress.value = Math.max(0, Math.min(1, -rect.top / scrollableDistance))
}

let ticking = false

function onScroll() {
  if (!ticking) {
    requestAnimationFrame(() => {
      updateProgress()
      ticking = false
    })
    ticking = true
  }
}

onMounted(() => {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion.value = mq.matches
  mq.addEventListener('change', (e) => {
    reducedMotion.value = e.matches
  })

  updateProgress()
  window.addEventListener('scroll', onScroll, { passive: true })
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
})
</script>

<style scoped>
.container-scroll {
  position: relative;
  min-height: 200vh;
}

.sticky-content {
  position: sticky;
  top: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.title-section {
  will-change: transform, opacity;
}

.card-section {
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  .title-section,
  .card-section {
    will-change: auto;
  }
}
</style>