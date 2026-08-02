<template>
  <span
    :class="['text-scroll-reveal', props.class]"
    ref="elRef"
    :aria-label="props.text"
    role="text"
  >
    <span
      v-for="(word, index) in words"
      :key="index"
      class="word"
      :class="{ revealed: index < effectiveRevealed }"
      :style="wordStyle(index)"
    >{{ word }}<span v-if="index < words.length - 1">&nbsp;</span></span>
  </span>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

interface TextScrollRevealProps {
  text: string
  class?: string
}

const props = defineProps<TextScrollRevealProps>()

const words = computed(() => props.text.split(/\s+/).filter(Boolean))
const elRef = ref<HTMLElement | null>(null)
const revealedCount = ref(0)
const reducedMotion = ref(false)
const animationComplete = ref(false)
let observer: IntersectionObserver | null = null

const effectiveRevealed = computed(() =>
  reducedMotion.value ? words.value.length : revealedCount.value
)

function wordStyle(index: number): Record<string, string> {
  return {
    transitionDelay: reducedMotion.value ? '0ms' : `${index * 30}ms`,
  }
}

onMounted(() => {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion.value = mq.matches

  const handleChange = (e: MediaQueryListEvent) => {
    reducedMotion.value = e.matches
  }
  mq.addEventListener('change', handleChange)

  if (reducedMotion.value || !elRef.value) return

  const thresholds = Array.from({ length: 21 }, (_, i) => +(i * 0.05).toFixed(2))

  observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[0]
      if (!entry) return

      // Once all words are revealed, mark complete and disconnect
      if (animationComplete.value) return

      // Accumulate the max ratio seen so words stay revealed once shown
      const ratio = Math.min(entry.intersectionRatio, 1)
      const maxRatio = Math.max(ratio, revealedCount.value / words.value.length)
      const count = Math.min(Math.floor(maxRatio * words.value.length), words.value.length)
      revealedCount.value = count

      if (count >= words.value.length) {
        animationComplete.value = true
        observer?.disconnect()
      }
    },
    { threshold: thresholds }
  )

  observer.observe(elRef.value)
})

onUnmounted(() => {
  observer?.disconnect()
})
</script>

<style scoped>
.text-scroll-reveal {
  display: inline;
}

.word {
  display: inline-block;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.4s var(--ease-out, ease-out),
              transform 0.4s var(--ease-out, ease-out);
  will-change: opacity, transform;
}

.word.revealed {
  opacity: 1;
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .word {
    opacity: 1;
    transform: translateY(0);
    transition: none;
  }
}
</style>