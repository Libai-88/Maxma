<template>
  <div :class="cn('balance-slider', props.class)">
    <div class="slider-header" v-if="props.label">
      <span class="slider-label">{{ props.label }}</span>
      <span v-if="showValue" class="slider-value">{{ displayValue }}</span>
    </div>
    <div class="slider-track">
      <div class="slider-fill" :style="fillStyle"></div>
      <input
        type="range"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        @input="onInput"
        class="slider-input"
      />
      <div class="slider-thumb" :style="thumbStyle"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

interface BalanceSliderProps {
  modelValue: number
  min?: number
  max?: number
  step?: number
  label?: string
  showValue?: boolean
  class?: string
}

const props = withDefaults(defineProps<BalanceSliderProps>(), {
  min: 0,
  max: 100,
  step: 1,
  showValue: true,
  class: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const percentage = computed(() => {
  const p = ((props.modelValue - props.min) / (props.max - props.min)) * 100
  return Math.max(0, Math.min(100, p))
})

const fillStyle = computed(() => ({
  width: `${percentage.value}%`,
}))

const thumbStyle = computed(() => ({
  left: `${percentage.value}%`,
}))

const displayValue = computed(() => {
  if (props.step >= 1) {
    return Math.round(props.modelValue)
  }
  return props.modelValue.toFixed(1)
})

function onInput(e: Event) {
  const target = e.target as HTMLInputElement
  emit('update:modelValue', parseFloat(target.value))
}
</script>

<style scoped>
.balance-slider {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.slider-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.slider-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
  user-select: none;
}

.slider-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  user-select: none;
}

.slider-track {
  position: relative;
  height: 8px;
  background: var(--border);
  border-radius: 9999px;
  overflow: visible;
  cursor: pointer;
}

.slider-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: var(--accent);
  border-radius: 9999px;
  pointer-events: none;
  transition: width var(--duration-fast, 0.15s) var(--ease-out, ease-out);
}

.slider-thumb {
  position: absolute;
  top: 50%;
  width: 18px;
  height: 18px;
  background: var(--accent);
  border: 3px solid var(--bg-secondary);
  border-radius: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  box-shadow: 0 2px 6px color-mix(in srgb, var(--accent) 30%, transparent);
  transition: left var(--duration-fast, 0.15s) var(--ease-out, ease-out);
  z-index: 2;
}

/* ── 原生 range input 隐藏 ── */
.slider-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
  z-index: 3;
  -webkit-appearance: none;
  appearance: none;
}

.slider-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 24px;
  height: 24px;
  cursor: pointer;
}

.slider-input::-moz-range-thumb {
  width: 24px;
  height: 24px;
  border: none;
  cursor: pointer;
}

/* ── 悬停增强 ── */
.slider-track:hover .slider-fill {
  filter: brightness(1.1);
}

.slider-track:hover .slider-thumb {
  box-shadow: 0 2px 10px color-mix(in srgb, var(--accent) 40%, transparent);
}

/* ── 聚焦样式 ── */
.slider-input:focus-visible ~ .slider-thumb {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

/* ── 无 label 时隐藏 header ── */
.balance-slider:not(:has(.slider-header)) .slider-track {
  margin-top: 0;
}

/* ── 缩减动画 ── */
@media (prefers-reduced-motion: reduce) {
  .slider-fill,
  .slider-thumb {
    transition: none;
  }
}
</style>