<template>
  <div
    class="card-spotlight"
    :class="rootClass"
    @mousemove="onMouseMove"
    @mouseleave="onMouseLeave"
  >
    <div
      class="card-spotlight-glow"
      :style="glowStyle"
    />
    <slot />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = withDefaults(defineProps<{
  gradientSize?: number
  gradientColor?: string
  gradientOpacity?: number
  class?: string
}>(), {
  gradientSize: 200,
  gradientColor: '#262626',
  gradientOpacity: 0.8,
  class: '',
})

const x = ref(50)
const y = ref(50)

const rootClass = computed(() => props.class || '')

const glowStyle = computed(() => ({
  '--x': `${x.value}%`,
  '--y': `${y.value}%`,
  background: `radial-gradient(${props.gradientSize}px circle at ${x.value}% ${y.value}%, ${props.gradientColor} ${props.gradientOpacity}, transparent 100%)`,
}))

function onMouseMove(e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  x.value = ((e.clientX - rect.left) / rect.width) * 100
  y.value = ((e.clientY - rect.top) / rect.height) * 100
}

function onMouseLeave() {
  x.value = 50
  y.value = 50
}
</script>

<style scoped>
.card-spotlight {
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 100%;
}

.card-spotlight-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  transition: background 0.15s ease;
  border-radius: inherit;
}
</style>