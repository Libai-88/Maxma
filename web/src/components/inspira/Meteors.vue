<template>
  <div
    :class="cn('meteors', props.class)"
    aria-hidden="true"
  >
    <span
      v-for="meteor in meteorsList"
      :key="meteor.id"
      class="meteor"
      :style="meteor.style"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  class?: string
  count?: number
  speed?: number
  size?: number
  color?: string
  trigger?: 'hover' | 'always'
}>(), {
  count: 5,
  speed: 1,
  size: 1,
  color: 'var(--accent, #6e5af0)',
  trigger: 'always',
})

interface Meteor {
  id: number
  style: Record<string, string>
}

const meteorsList = computed<Meteor[]>(() => {
  const items: Meteor[] = []
  for (let i = 0; i < props.count; i++) {
    const delay = Math.random() * 5
    const duration = (1 + Math.random() * 2) / props.speed
    const top = Math.random() * 100
    const left = Math.random() * 100
    const angle = -30 + Math.random() * -15

    items.push({
      id: i,
      style: {
        top: `${top}%`,
        left: `${left}%`,
        width: `${props.size}px`,
        height: `${props.size * 60}px`,
        '--duration': `${duration}s`,
        '--delay': `${delay}s`,
        '--angle': `${angle}deg`,
        '--color': props.color,
      },
    })
  }
  return items
})
</script>

<style scoped>
.meteors {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 0;
}

.meteor {
  position: absolute;
  border-radius: 999px;
  background: linear-gradient(
    to bottom,
    var(--color),
    transparent
  );
  animation: meteor-fall var(--duration, 2s) ease-in-out infinite;
  animation-delay: var(--delay, 0s);
  transform: rotate(var(--angle, -30deg));
  will-change: transform, opacity;
}

@keyframes meteor-fall {
  0% {
    transform: rotate(var(--angle, -30deg)) translateY(-100%) translateX(0);
    opacity: 1;
  }
  20% {
    opacity: 1;
  }
  100% {
    transform: rotate(var(--angle, -30deg)) translateY(calc(100vh + 100px)) translateX(calc(-100vw * 0.5));
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .meteor {
    animation: none;
    display: none;
  }
}
</style>