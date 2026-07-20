<template>
  <span
    ref="rootRef"
    class="sticker-inline"
    :class="{ paused: shouldUsePoster, loading: !displaySrc }"
    :title="shouldUsePoster ? '动图已暂停' : displayFilename"
    @click="$emit('preview', displaySticker)"
  >
    <img
      v-if="shouldUsePoster && posterSrc"
      :src="posterSrc"
      class="sticker-img"
      loading="lazy"
      :alt="displayFilename"
    />
    <img
      v-else-if="displaySrc"
      ref="imgRef"
      :src="displaySrc"
      class="sticker-img"
      loading="lazy"
      :alt="displayFilename"
      @load="capturePoster"
    />
    <span v-else class="sticker-loading" aria-hidden="true">✨</span>
    <span v-if="shouldUsePoster" class="paused-badge">动图已暂停</span>
  </span>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { StickerSegment } from '@/composables/useStickerSegments'
import { tauriFetch } from '@/utils/env'
import { useTheme } from '@/composables/useTheme'
import { useFPSMonitor, useStickerPerformance } from '@/composables/useStickerPerformance'

const props = defineProps<{ sticker: StickerSegment }>()

defineEmits<{
  preview: [sticker: StickerSegment]
}>()

const rootRef = ref<HTMLElement | null>(null)
const imgRef = ref<HTMLImageElement | null>(null)
const posterSrc = ref('')
const resolvedSrc = ref('')
const resolvedPath = ref('')
const resolvedFilename = ref('')

const displaySrc = computed(() => props.sticker.src || resolvedSrc.value)
const displayFilename = computed(() => props.sticker.filename || resolvedFilename.value || props.sticker.category || 'sticker')
const displaySticker = computed<StickerSegment>(() => ({
  ...props.sticker,
  src: displaySrc.value,
  path: resolvedPath.value || props.sticker.path,
  filename: displayFilename.value,
}))

async function loadRandomSticker() {
  if (props.sticker.src || !props.sticker.category) return
  try {
    const res = await tauriFetch(`/api/stickers/random/${encodeURIComponent(props.sticker.category)}`)
    if (!res.ok) return
    const data = await res.json()
    if (data?.path) {
      resolvedSrc.value = `/api/stickers/${data.path}`
      resolvedPath.value = data.path
      resolvedFilename.value = String(data.path).split('/').pop() || ''
    }
  } catch (err) {
    console.warn('[StickerInline] failed to load random sticker:', err)
  }
}

onMounted(() => {
  if (!props.sticker.src && props.sticker.category) {
    loadRandomSticker()
  }
})

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

.sticker-inline.loading {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-secondary) 80%, transparent);
  border: 1px dashed var(--border);
}

.sticker-loading {
  font-size: 24px;
  animation: stickerLoadingPulse 1.2s ease-in-out infinite;
}

@keyframes stickerLoadingPulse {
  0%, 100% { opacity: 0.6; transform: scale(0.95); }
  50% { opacity: 1; transform: scale(1.05); }
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
