<template>
  <span :class="cn('colourful-text', props.class)" :style="textStyle">
    {{ props.text }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  text: string
  colors?: string[]
  duration?: number
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  colors: () => ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#9b59b6'],
  duration: 3,
  class: '',
})

const textStyle = computed(() => {
  const colors = props.colors
  const cssVars: Record<string, string> = {
    '--ct-duration': `${props.duration}s`,
  }

  for (let i = 0; i < 5; i++) {
    const color = colors[i % colors.length]
    cssVars[`--ct-c${i + 1}`] = color
  }

  return cssVars
})
</script>

<style scoped>
.colourful-text {
  background: linear-gradient(
    90deg,
    var(--ct-c1),
    var(--ct-c2),
    var(--ct-c3),
    var(--ct-c4),
    var(--ct-c5),
    var(--ct-c1)
  );
  background-size: 200% auto;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: colourful-shift var(--ct-duration, 3s) linear infinite;
}

@keyframes colourful-shift {
  to {
    background-position: 200% center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .colourful-text {
    animation: none;
  }
}
</style>