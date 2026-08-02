<template>
  <svg
    class="animated-beam"
    :class="cn(props.class)"
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    fill="none"
    aria-hidden="true"
  >
    <!-- 主光束线 -->
    <path
      :d="pathD"
      :stroke="color"
      stroke-width="2"
      stroke-linecap="round"
      class="beam-path"
    />
    <!-- 发光光晕 -->
    <path
      :d="pathD"
      :stroke="color"
      stroke-width="4"
      stroke-linecap="round"
      class="beam-glow"
      :style="{ filter: `blur(${blur}px)` }"
    />
    <!-- 流动粒子 -->
    <circle
      r="2.5"
      :fill="color"
      class="beam-particle"
      :style="{
        animationDuration: `${duration}s`,
        animationDelay: `${delay}s`,
      }"
    >
      <animateMotion
        :dur="`${duration}s`"
        :begin="`${delay}s`"
        repeatCount="indefinite"
        :path="pathD"
      />
    </circle>
  </svg>
</template>

<script setup lang="ts">
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<{
  class?: string
  width?: number
  height?: number
  pathD?: string
  color?: string
  blur?: number
  duration?: number
  delay?: number
}>(), {
  width: 200,
  height: 40,
  pathD: 'M 0 20 Q 50 0, 100 20 T 200 20',
  color: 'var(--accent, #6e5af0)',
  blur: 6,
  duration: 3,
  delay: 0,
})
</script>

<style scoped>
.animated-beam {
  position: absolute;
  pointer-events: none;
  overflow: visible;
}

.beam-path {
  opacity: 0.3;
}

.beam-glow {
  opacity: 0.15;
}

.beam-particle {
  opacity: 0.8;
}

@media (prefers-reduced-motion: reduce) {
  .beam-path,
  .beam-glow {
    opacity: 0.15;
  }
  .beam-particle {
    display: none;
  }
}
</style>