<template>
  <div :class="cn('sparkles', props.class)" aria-hidden="true">
    <span
      v-for="sparkle in sparkles"
      :key="sparkle.id"
      class="sparkle"
      :style="sparkle.style"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  density?: number
  size?: number
  speed?: number
  class?: string
}>(), {
  density: 15,
  size: 2,
  speed: 1,
})

interface Sparkle {
  id: number
  style: Record<string, string>
}

const sparkles = ref<Sparkle[]>([])

let idCounter = 0

function generateSparkles() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const items: Sparkle[] = []

  for (let i = 0; i < props.density; i++) {
    const sparkleSize = Math.random() * props.size + 1
    const delay = Math.random() * 3
    const duration = (Math.random() * 2 + 1.5) / props.speed

    items.push({
      id: ++idCounter,
      style: {
        top: `${Math.random() * 100}%`,
        left: `${Math.random() * 100}%`,
        width: `${sparkleSize}px`,
        height: `${sparkleSize}px`,
        '--duration': prefersReducedMotion ? '0s' : `${duration}s`,
        '--delay': prefersReducedMotion ? '0s' : `${delay}s`,
        animation: prefersReducedMotion ? 'none' : '',
      },
    })
  }

  sparkles.value = items
}

onMounted(() => {
  generateSparkles()
})
</script>

<style scoped>
.sparkles {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 0;
}

.sparkle {
  position: absolute;
  border-radius: 50%;
  background: var(--accent, #6e5af0);
  pointer-events: none;
  animation: sparkle-twinkle var(--duration, 2s) ease-in-out infinite;
  animation-delay: var(--delay, 0s);
}

@keyframes sparkle-twinkle {
  0%, 100% { opacity: 0; transform: scale(0); }
  50% { opacity: 0.8; transform: scale(1); }
}
</style>