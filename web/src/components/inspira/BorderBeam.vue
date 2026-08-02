<template>
  <div :class="cn('border-beam', props.class)" :style="containerStyle">
    <div class="border-beam-mask">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  duration?: number
  size?: number
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  duration: 4,
  size: 200,
})

const containerStyle = computed(() => ({
  '--beam-size': `${props.size}px`,
  '--beam-duration': `${props.duration}s`,
}))
</script>

<style scoped>
.border-beam {
  position: relative;
  overflow: hidden;
  border-radius: inherit;
}

.border-beam::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: conic-gradient(
    from 0deg,
    transparent,
    var(--accent, #6e5af0),
    transparent 30%,
    transparent 60%,
    var(--accent, #6e5af0),
    transparent 90%
  );
  animation: beam-rotate var(--beam-duration, 4s) linear infinite;
  z-index: 0;
}

.border-beam-mask {
  position: relative;
  z-index: 1;
  margin: 2px;
  border-radius: inherit;
  background: var(--bg-card);
}

@keyframes beam-rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .border-beam::before {
    animation: none;
  }
}
</style>