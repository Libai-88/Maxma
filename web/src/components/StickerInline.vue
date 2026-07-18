<template>
  <span
    ref="rootRef"
    class="sticker-inline"
    :class="{ paused: shouldUsePoster }"
    :title="shouldUsePoster ? '动图已暂停' : sticker.filename"
    @click="$emit('preview', sticker)"
  >
    <img
      v-if="shouldUsePoster && posterSrc"
      :src="posterSrc"
      class="sticker-img"
      loading="lazy"
      :alt="sticker.filename"
    />
    <img
      v-else
      ref="imgRef"
      :src="sticker.src"
      class="sticker-img"
      loading="lazy"
      :alt="sticker.filename"
      @load="capturePoster"
    />
    <span v-if="shouldUsePoster" class="paused-badge">动图已暂停</span>
  </span>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { StickerSegment } from '@/composables/useStickerSegments'
import { useTheme } from '@/composables/useTheme'
import { useFPSMonitor, useStickerPerformance } from '@/composables/useStickerPerformance'

defineProps<{ sticker: StickerSegment }>()

defineEmits<{
  preview: [sticker: StickerSegment]
}>()

const rootRef = ref<HTMLElement | null>(null)
const imgRef = ref<HTMLImageElement | null>(null)
const posterSrc = ref('')

const { isVisible } = useStickerPerformance(rootRef)
const { isLowPerformance } = useFPSMonitor()
const { isDark: isNightMode } = useTheme()

const shouldUsePoster = computed(() =>
  Boolean(posterSrc.value) && (!isVisible.value || isLowPerformance.value || isNightMode.value)
)

function capturePoster() {
  const img = imgRef.value
  if (!img || posterSrc.value || !img.naturalWidth || !img.naturalHeight) return

  try {
    const maxSize = 240
    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    posterSrc.value = canvas.toDataURL('image/webp', 0.82)
  } catch {
    posterSrc.value = ''
  }
}
</script>

<style scoped>
.sticker-inline {
  position: relative;
  display: inline-block;
  vertical-align: middle;
  margin: 4px 6px;
  cursor: pointer;
}

.sticker-img {
  width: 100px;
  height: 100px;
  object-fit: contain;
  transition: transform 0.15s ease;
  display: block;
  animation: stickerAppear 0.2s ease-out;
}

.sticker-inline:hover .sticker-img {
  transform: scale(1.15);
}

.sticker-inline.paused .sticker-img {
  filter: saturate(0.9);
}

.paused-badge {
  position: absolute;
  left: 50%;
  bottom: 4px;
  transform: translateX(-50%);
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.72);
  color: #fff;
  font-size: 10px;
  line-height: 1.2;
  white-space: nowrap;
  pointer-events: none;
}

@keyframes stickerAppear {
  from {
    opacity: 0;
    transform: scale(0.8);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sticker-img {
    animation: none;
    transition: none;
  }

  .sticker-inline:hover .sticker-img {
    transform: none;
  }
}
</style>
