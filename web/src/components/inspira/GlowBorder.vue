<template>
  <div :class="cn('glow-border', props.class)" :style="containerStyle">
    <div class="glow-border-inner">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  color?: string
  duration?: number
  blur?: number
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  color: 'var(--accent)',
  duration: 3,
  blur: 8,
})

const containerStyle = computed(() => ({
  '--glow-color': props.color,
  '--glow-duration': `${props.duration}s`,
  '--glow-blur': `${props.blur}px`,
}))
</script>

<style scoped>
.glow-border {
  position: relative;
  border-radius: inherit;
  animation: glow-pulse var(--glow-duration, 3s) ease-in-out infinite;
}

.glow-border-inner {
  position: relative;
  z-index: 1;
  border-radius: inherit;
}

@keyframes glow-pulse {
  0%,
  100% {
    box-shadow:
      0 0 calc(var(--glow-blur, 8px) * 0.5) color-mix(in srgb, var(--glow-color, var(--accent)) 30%, transparent),
      0 0 var(--glow-blur, 8px) color-mix(in srgb, var(--glow-color, var(--accent)) 15%, transparent);
  }
  50% {
    box-shadow:
      0 0 calc(var(--glow-blur, 8px) * 0.8) color-mix(in srgb, var(--glow-color, var(--accent)) 50%, transparent),
      0 0 calc(var(--glow-blur, 8px) * 1.5) color-mix(in srgb, var(--glow-color, var(--accent)) 25%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .glow-border {
    animation: none;
    box-shadow:
      0 0 calc(var(--glow-blur, 8px) * 0.5) color-mix(in srgb, var(--glow-color, var(--accent)) 30%, transparent),
      0 0 var(--glow-blur, 8px) color-mix(in srgb, var(--glow-color, var(--accent)) 15%, transparent);
  }
}
</style>