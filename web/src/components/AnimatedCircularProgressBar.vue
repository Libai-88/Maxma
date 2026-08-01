<template>
  <div class="acpb" :style="{ width: size + 'px', height: size + 'px' }">
    <svg viewBox="0 0 24 24" class="acpb-svg" aria-hidden="true">
      <circle
        class="acpb-track"
        :cx="12" :cy="12"
        :r="radius"
        :stroke-width="strokeWidth"
        :stroke="secondaryColor"
      />
      <circle
        ref="fillRef"
        class="acpb-fill"
        :cx="12" :cy="12"
        :r="radius"
        :stroke-width="strokeWidth"
        :stroke="primaryColor"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="circumference"
        stroke-linecap="round"
      />
    </svg>
    <span v-if="showPercentage" class="acpb-text" :style="{ fontSize: (size * 0.375) + 'px' }">
      {{ displayText }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { gsap } from '@/composables/useGsap'

const props = withDefaults(defineProps<{
  value?: number
  max?: number
  min?: number
  primaryColor?: string
  secondaryColor?: string
  strokeWidth?: number
  showPercentage?: boolean
  duration?: number
  size?: number
}>(), {
  value: 0,
  max: 100,
  min: 0,
  primaryColor: 'rgb(79 70 229)',
  secondaryColor: 'rgba(0, 0, 0, 0.1)',
  strokeWidth: 3,
  showPercentage: true,
  duration: 0.6,
  size: 24,
})

// 归一化百分比 0–100
const pct = computed(() => {
  const range = props.max - props.min
  if (range <= 0) return 0
  return Math.max(0, Math.min(100, ((props.value - props.min) / range) * 100))
})

const displayText = computed(() => `${Math.round(pct.value)}`)

const radius = 9
const strokeWidth = props.strokeWidth
const circumference = 2 * Math.PI * radius

const fillRef = ref<SVGCircleElement | null>(null)

// 初始值动画
function animateTo(pctVal: number) {
  const el = fillRef.value
  if (!el) return
  const targetOffset = circumference * (1 - pctVal / 100)
  gsap.to(el, {
    attr: { strokeDashoffset: targetOffset },
    duration: props.duration,
    ease: 'power2.out',
    overwrite: 'auto',
  })
}

onMounted(() => {
  animateTo(pct.value)
})

watch(pct, (val) => {
  animateTo(val)
})
</script>

<style scoped>
.acpb {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.acpb-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.acpb-track {
  fill: none;
}

.acpb-fill {
  fill: none;
  stroke-linecap: round;
}

.acpb-text {
  position: relative;
  z-index: 1;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary, inherit);
}
</style>