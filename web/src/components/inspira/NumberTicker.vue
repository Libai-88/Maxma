<template>
  <span :class="cn('number-ticker', props.class)" ref="spanRef">{{ displayValue }}</span>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { gsap, easeMap } from '@/composables/useGsap'
import { cn } from '@/lib/utils'

interface NumberTickerProps {
  value: number
  duration?: number
  delay?: number
  decimalPlaces?: number
  class?: string
}

const props = withDefaults(defineProps<NumberTickerProps>(), {
  duration: 0.8,
  delay: 0,
  decimalPlaces: 0,
  class: '',
})

const spanRef = ref<HTMLElement | null>(null)
const currentValue = ref(0)
let animation: gsap.core.Tween | null = null
let reducedMotion = false

const displayValue = computed(() => {
  return currentValue.value.toFixed(props.decimalPlaces)
})

function animateTo(target: number) {
  if (animation) {
    animation.kill()
  }

  const from = currentValue.value

  if (reducedMotion || from === target) {
    currentValue.value = target
    return
  }

  const proxy = { value: from }

  animation = gsap.to(proxy, {
    value: target,
    duration: props.duration,
    delay: props.delay,
    ease: easeMap.out,
    onUpdate: () => {
      currentValue.value = proxy.value
    },
    onComplete: () => {
      currentValue.value = target
      animation = null
    },
  })
}

onMounted(() => {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion = mq.matches

  const handleChange = (e: MediaQueryListEvent) => {
    reducedMotion = e.matches
  }
  mq.addEventListener('change', handleChange)

  animateTo(props.value)
})

onUnmounted(() => {
  if (animation) {
    animation.kill()
    animation = null
  }
})

watch(
  () => props.value,
  (newVal) => {
    animateTo(newVal)
  },
)
</script>

<style scoped>
.number-ticker {
  font-variant-numeric: tabular-nums;
}

@media (prefers-reduced-motion: reduce) {
  .number-ticker {
    transition: none;
  }
}
</style>