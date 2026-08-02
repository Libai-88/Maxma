<template>
  <div
    class="direction-aware-hover"
    :class="rootClass"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <img
      v-if="imageUrl"
      :src="imageUrl"
      alt=""
      class="direction-aware-hover-img"
      :class="resolvedImageClass"
    />
    <div
      class="direction-aware-hover-overlay"
      :class="resolvedChildrenClass"
      :style="overlayStyle"
    >
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = withDefaults(defineProps<{
  imageUrl?: string
  class?: string
  imageClass?: string
  childrenClass?: string
}>(), {
  imageUrl: '',
  class: '',
  imageClass: '',
  childrenClass: '',
})

const direction = ref<'top' | 'right' | 'bottom' | 'left'>('left')
const isVisible = ref(false)

const rootClass = computed(() => props.class || '')
const resolvedImageClass = computed(() => props.imageClass || '')
const resolvedChildrenClass = computed(() => props.childrenClass || '')

function getTransform(dir: 'top' | 'right' | 'bottom' | 'left'): string {
  switch (dir) {
    case 'top': return 'translateY(-100%)'
    case 'right': return 'translateX(100%)'
    case 'bottom': return 'translateY(100%)'
    case 'left': return 'translateX(-100%)'
  }
}

function getDirection(e: MouseEvent, el: HTMLElement): 'top' | 'right' | 'bottom' | 'left' {
  const rect = el.getBoundingClientRect()
  const x = e.clientX - rect.left - rect.width / 2
  const y = e.clientY - rect.top - rect.height / 2
  const angle = (Math.atan2(y, x) * 180) / Math.PI

  if (angle >= -45 && angle <= 45) return 'right'
  if (angle >= 45 && angle <= 135) return 'bottom'
  if (angle >= -135 && angle <= -45) return 'top'
  return 'left'
}

const overlayStyle = computed(() => {
  const t = getTransform(direction.value)
  return {
    transform: isVisible.value ? 'translate(0, 0)' : t,
    opacity: isVisible.value ? 1 : 0,
  }
})

function onMouseEnter(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  direction.value = getDirection(e, el)
  isVisible.value = false

  // Force reflow so the off-screen position is painted before transitioning in
  void el.offsetHeight

  isVisible.value = true
}

function onMouseLeave() {
  isVisible.value = false
}
</script>

<style scoped>
.direction-aware-hover {
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 100%;
}

.direction-aware-hover-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.direction-aware-hover-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  pointer-events: none;
  transition: transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94),
              opacity 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  will-change: transform, opacity;
}

@media (prefers-reduced-motion: reduce) {
  .direction-aware-hover-overlay {
    transition: none;
  }
}
</style>