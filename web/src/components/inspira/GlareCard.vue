<template>
  <div
    class="glare-card"
    :class="rootClass"
    @mousemove="onMouseMove"
    @mouseleave="onMouseLeave"
  >
    <div
      class="glare-card-reflection"
      :style="reflectionStyle"
      aria-hidden="true"
    />
    <slot />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = withDefaults(defineProps<{
  class?: string
}>(), {
  class: '',
})

const x = ref(50)
const y = ref(50)
const isHovered = ref(false)

const rootClass = computed(() => props.class || '')

const reflectionStyle = computed(() => {
  if (!isHovered.value) {
    return { opacity: 0 }
  }
  const glareX = 100 - x.value
  const glareY = 100 - y.value
  return {
    background: `radial-gradient(600px circle at ${glareX}% ${glareY}%, rgba(255,255,255,0.08), transparent 40%)`,
    opacity: 1,
  }
})

function onMouseMove(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  x.value = ((e.clientX - rect.left) / rect.width) * 100
  y.value = ((e.clientY - rect.top) / rect.height) * 100
  isHovered.value = true
}

function onMouseLeave() {
  isHovered.value = false
}
</script>

<style scoped>
.glare-card {
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 100%;
  border-radius: inherit;
}

.glare-card-reflection {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
  border-radius: inherit;
  transition: opacity 0.3s ease;
  will-change: opacity, background;
}

/* Respect user's motion preferences */
@media (prefers-reduced-motion: reduce) {
  .glare-card-reflection {
    display: none;
  }
}
</style>