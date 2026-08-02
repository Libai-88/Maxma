<template>
  <div
    ref="cardRef"
    class="floating-card"
    :class="cn(props.class)"
    @mousemove="onMouseMove"
    @mouseleave="onMouseLeave"
  >
    <div class="floating-card-inner" :style="innerStyle">
      <slot />
    </div>
    <div v-if="glow" class="floating-card-glow" :style="glowStyle" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  class?: string
  intensity?: number
  glow?: boolean
  perspective?: number
}>(), {
  intensity: 8,
  glow: true,
  perspective: 800,
})

const cardRef = ref<HTMLElement | null>(null)
const rotateX = ref(0)
const rotateY = ref(0)
const glowX = ref(50)
const glowY = ref(50)

const innerStyle = computed(() => ({
  transform: `perspective(${props.perspective}px) rotateX(${rotateX.value}deg) rotateY(${rotateY.value}deg)`,
}))

const glowStyle = computed(() => ({
  background: `radial-gradient(circle at ${glowX.value}% ${glowY.value}%, color-mix(in srgb, var(--accent) 20%, transparent) 0%, transparent 60%)`,
}))

function onMouseMove(e: MouseEvent) {
  const el = cardRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const px = (e.clientX - r.left) / r.width
  const py = (e.clientY - r.top) / r.height
  rotateX.value = -(py - 0.5) * props.intensity * 2
  rotateY.value = (px - 0.5) * props.intensity * 2
  glowX.value = px * 100
  glowY.value = py * 100
}

function onMouseLeave() {
  rotateX.value = 0
  rotateY.value = 0
  glowX.value = 50
  glowY.value = 50
}
</script>

<style scoped>
.floating-card {
  position: relative;
  transform-style: preserve-3d;
  transition: transform 0.1s ease;
}

.floating-card-inner {
  position: relative;
  z-index: 1;
  transition: transform 0.15s ease-out;
  will-change: transform;
}

.floating-card-glow {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  border-radius: inherit;
  transition: background 0.15s ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .floating-card-inner {
    transition: none;
  }
  .floating-card:hover .floating-card-inner {
    transform: none !important;
  }
}
</style>