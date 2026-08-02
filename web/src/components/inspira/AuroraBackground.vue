<template>
  <div
    class="aurora-bg"
    :class="props.class"
    aria-hidden="true"
    :style="auroraStyle"
  >
    <div
      v-for="n in auroraCount"
      :key="n"
      class="aurora-beam"
      :style="beamStyle(n)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  class?: string
  opacity?: number
  speed?: number
  colors?: string[]
  auroraCount?: number
}>(), {
  opacity: 0.15,
  speed: 1,
  auroraCount: 3,
  colors: () => ['#3b82f6', '#8b5cf6', '#06b6d4'],
})

const auroraStyle = computed(() => ({
  opacity: props.opacity,
  '--speed': props.speed,
}))

function beamStyle(index: number) {
  const color = props.colors[(index - 1) % props.colors.length]
  const delay = index * 2.5
  const duration = 8 + index * 3
  const top = 20 + (index - 1) * 25
  const left = 10 + (index - 1) * 35

  return {
    '--beam-color': color,
    '--delay': `${delay}s`,
    '--duration': `${duration}s`,
    top: `${top}%`,
    left: `${left}%`,
    width: `${300 + index * 60}px`,
    height: `${200 + index * 40}px`,
  }
}
</script>

<style scoped>
.aurora-bg {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  overflow: hidden;
  mask-image: radial-gradient(ellipse 80% 60% at 50% 40%, black 30%, transparent 70%);
  -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 40%, black 30%, transparent 70%);
}

.aurora-beam {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  background: var(--beam-color);
  animation: aurora-float var(--duration, 10s) ease-in-out infinite;
  animation-delay: var(--delay, 0s);
  will-change: transform, opacity;
}

@keyframes aurora-float {
  0%, 100% {
    transform: translate(0, 0) scale(1) rotate(0deg);
    opacity: 0.6;
  }
  25% {
    transform: translate(30px, -20px) scale(1.15) rotate(5deg);
    opacity: 0.8;
  }
  50% {
    transform: translate(-20px, 15px) scale(0.9) rotate(-3deg);
    opacity: 0.5;
  }
  75% {
    transform: translate(40px, -10px) scale(1.1) rotate(4deg);
    opacity: 0.7;
  }
}

@media (prefers-reduced-motion: reduce) {
  .aurora-beam {
    animation: none;
  }
}
</style>