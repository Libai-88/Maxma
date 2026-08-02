<template>
  <div :class="cn('bento-grid', props.class)" :style="gridStyle">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

interface BentoGridProps {
  cols?: number
  gap?: number
  class?: string
}

const props = withDefaults(defineProps<BentoGridProps>(), {
  cols: 3,
  gap: 4,
})

const gridStyle = computed(() => ({
  display: 'grid',
  gridTemplateColumns: `repeat(${props.cols}, 1fr)`,
  gap: `${props.gap * 4}px`,
}))
</script>

<style scoped>
/* 桌面端：使用动态 cols */
.bento-grid {
  width: 100%;
}

/* 移动端：小于 768px 时切换为单列 */
@media (max-width: 767px) {
  .bento-grid {
    grid-template-columns: 1fr !important;
  }
}
</style>