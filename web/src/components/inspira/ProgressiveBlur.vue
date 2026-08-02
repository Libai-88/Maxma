<template>
  <div :class="cn('progressive-blur', props.class)">
    <div
      v-for="i in blurLayers"
      :key="i"
      class="progressive-blur-layer"
      :style="getLayerStyle(i)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  direction?: 'top' | 'right' | 'bottom' | 'left'
  blurLayers?: number
  blurIntensity?: number
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  direction: 'bottom',
  blurLayers: 8,
  blurIntensity: 0.25,
  class: '',
})

const isHorizontal = computed(() => props.direction === 'left' || props.direction === 'right')

function getLayerStyle(index: number) {
  const blur = index * props.blurIntensity
  const total = props.blurLayers
  const size = 100 / total

  let top = 0
  let left = 0
  let width = '100%'
  let height = '100%'

  switch (props.direction) {
    case 'bottom':
      top = (index - 1) * size
      height = `${size}%`
      break
    case 'top':
      top = 100 - index * size
      height = `${size}%`
      break
    case 'right':
      left = (index - 1) * size
      width = `${size}%`
      break
    case 'left':
      left = 100 - index * size
      width = `${size}%`
      break
  }

  return {
    top: `${top}%`,
    left: `${left}%`,
    width: isHorizontal.value ? `${width}` : '100%',
    height: isHorizontal.value ? '100%' : `${height}`,
    backdropFilter: `blur(${blur}px)`,
    WebkitBackdropFilter: `blur(${blur}px)`,
    zIndex: index,
  }
}
</script>

<style scoped>
.progressive-blur {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.progressive-blur-layer {
  position: absolute;
  pointer-events: none;
}
</style>