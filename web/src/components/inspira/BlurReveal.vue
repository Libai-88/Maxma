<template>
  <div :class="cn('blur-reveal', props.class)" :style="revealStyle">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

interface BlurRevealProps {
  blur?: number
  duration?: number
  delay?: number
  class?: string
}

const props = withDefaults(defineProps<BlurRevealProps>(), {
  blur: 4,
  duration: 0.6,
  delay: 0,
  class: '',
})

const revealStyle = computed(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reducedMotion) {
    return { opacity: 1 }
  }
  return {
    animation: `blur-reveal-in ${props.duration}s ease ${props.delay}s forwards`,
    '--blur-start': `${props.blur}px`,
  } as Record<string, string>
})
</script>

<style scoped>
.blur-reveal {
  opacity: 0;
}

@keyframes blur-reveal-in {
  0% {
    opacity: 0;
    filter: blur(var(--blur-start, 4px));
  }
  100% {
    opacity: 1;
    filter: blur(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .blur-reveal {
    animation: none !important;
    opacity: 1;
  }
}
</style>