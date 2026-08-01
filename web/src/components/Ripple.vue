<template>
  <div class="ripple-container" :class="containerClass" aria-hidden="true">
    <div
      v-for="i in circleCount"
      :key="i"
      class="ripple-circle"
      :class="circleClass"
      :style="circleStyle(i)"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    baseCircleSize?: number
    baseCircleOpacity?: number
    circleOpacityDowngradeRatio?: number
    waveSpeed?: number
    spaceBetweenCircle?: number
    numberOfCircles?: number
    containerClass?: string
    circleClass?: string
  }>(),
  {
    baseCircleSize: 210,
    baseCircleOpacity: 0.24,
    circleOpacityDowngradeRatio: 0.03,
    waveSpeed: 80,
    spaceBetweenCircle: 70,
    numberOfCircles: 7,
    containerClass: '',
    circleClass: '',
  },
)

const circleCount = computed(() => Math.max(1, props.numberOfCircles))

function circleStyle(index: number) {
  const size = props.baseCircleSize + (index - 1) * props.spaceBetweenCircle
  const baseOpacity = Math.max(0, props.baseCircleOpacity - (index - 1) * props.circleOpacityDowngradeRatio)
  const delay = ((index - 1) * props.spaceBetweenCircle) / props.waveSpeed
  const duration = 3 + (index - 1) * 0.15

  return {
    width: `${size}px`,
    height: `${size}px`,
    '--base-opacity': `${baseOpacity}`,
    '--duration': `${duration}s`,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
  } as Record<string, string>
}
</script>

<style scoped>
.ripple-container {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  overflow: hidden;
  z-index: 0;
}

.ripple-circle {
  position: absolute;
  border-radius: 50%;
  border: 2px solid;
  border-color: color-mix(in srgb, var(--accent) 30%, transparent);
  background: transparent;
  animation: ripple-breathe var(--duration, 3s) ease-in-out infinite;
  will-change: transform, opacity;
}

@media (prefers-reduced-motion: reduce) {
  .ripple-circle {
    animation: none;
  }
}

@keyframes ripple-breathe {
  0% {
    transform: scale(0.92);
    opacity: var(--base-opacity, 0.24);
  }
  50% {
    transform: scale(1.08);
    opacity: calc(var(--base-opacity, 0.24) * 0.5);
  }
  100% {
    transform: scale(0.92);
    opacity: var(--base-opacity, 0.24);
  }
}
</style>