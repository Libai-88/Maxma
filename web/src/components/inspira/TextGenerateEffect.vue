<template>
  <div :class="cn('text-generate-effect', props.class)">
    <span
      v-for="(char, index) in chars"
      :key="index"
      class="text-generate-char"
      :style="{ animationDelay: `${index * (duration / chars.length) + delay}s` }"
    >{{ char === ' ' ? '\u00A0' : char }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

interface TextGenerateEffectProps {
  words: string
  duration?: number
  delay?: number
  class?: string
}

const props = withDefaults(defineProps<TextGenerateEffectProps>(), {
  duration: 2,
  delay: 0,
  class: '',
})

const chars = computed(() => props.words.split(''))
</script>

<style scoped>
.text-generate-effect {
  display: inline;
}

.text-generate-char {
  opacity: 0;
  animation: text-generate-reveal 0.3s ease forwards;
  will-change: opacity, transform, filter;
}

@keyframes text-generate-reveal {
  0% {
    opacity: 0;
    transform: translateY(8px);
    filter: blur(2px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
    filter: blur(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .text-generate-char {
    opacity: 1;
    animation: none;
  }
}
</style>