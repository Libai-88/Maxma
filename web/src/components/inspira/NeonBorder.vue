<template>
  <div
    :class="cn('neon-border', props.class, {
      'neon-border--active': active,
      'neon-border--pulse': pulse,
    })"
    :style="containerStyle"
  >
    <slot />
    <div class="neon-border-line" :style="lineStyle" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  class?: string
  color?: string
  active?: boolean
  pulse?: boolean
  blur?: number
  width?: number
  duration?: number
}>(), {
  color: 'var(--accent, #6e5af0)',
  active: false,
  pulse: false,
  blur: 8,
  width: 2,
  duration: 2,
})

const containerStyle = computed(() => ({
  position: 'relative' as const,
}))

const lineStyle = computed(() => ({
  '--nc-color': props.color,
  '--nc-blur': `${props.blur}px`,
  '--nc-width': `${props.width}px`,
  '--nc-duration': `${props.duration}s`,
}))
</script>

<style scoped>
.neon-border {
  border-radius: inherit;
}

.neon-border-line {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  border: var(--nc-width) solid transparent;
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
}

.neon-border--active .neon-border-line {
  border-color: var(--nc-color);
  box-shadow:
    0 0 var(--nc-blur) var(--nc-color),
    inset 0 0 var(--nc-blur) var(--nc-color);
}

.neon-border--pulse.neon-border--active .neon-border-line {
  animation: neon-pulse var(--nc-duration, 2s) ease-in-out infinite;
}

@keyframes neon-pulse {
  0%, 100% {
    box-shadow:
      0 0 var(--nc-blur) var(--nc-color),
      inset 0 0 var(--nc-blur) var(--nc-color);
    opacity: 1;
  }
  50% {
    box-shadow:
      0 0 calc(var(--nc-blur) * 0.5) var(--nc-color),
      inset 0 0 calc(var(--nc-blur) * 0.5) var(--nc-color);
    opacity: 0.6;
  }
}

@media (prefers-reduced-motion: reduce) {
  .neon-border--pulse.neon-border--active .neon-border-line {
    animation: none;
  }
}
</style>