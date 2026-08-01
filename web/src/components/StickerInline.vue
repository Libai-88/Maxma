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
    <Icon v-else class="sticker-loading" name="sparkles" :size="20" />
    <span v-if="shouldUsePoster" class="paused-badge">动图已暂停</span>
  </span>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { StickerSegment } from '@/composables/useStickerSegments'
import { getApiBase, tauriFetch } from '@/utils/env'
import { useStickerPerformance } from '@/composables/useStickerPerformance'
import Icon from '@/components/Icon.vue'
import { gsap, useGsap } from '@/composables/useGsap'
import { createLogger } from '@/utils/logger'

const log = createLogger('StickerInline')

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
    const res = await tauriFetch(`${getApiBase()}/stickers/random/${encodeURIComponent(props.sticker.category)}`)
    if (!res.ok) return
    const data = await res.json()
    if (data?.path) {
      resolvedSrc.value = `${getApiBase()}/stickers/${data.path}`
      resolvedPath.value = data.path
      resolvedFilename.value = String(data.path).split('/').pop() || ''
    }
  } catch (err) {
    log.warn('[StickerInline] failed to load random sticker:', err)
  }
}

onMounted(() => {
  if (!props.sticker.src && props.sticker.category) {
    loadRandomSticker()
  }
})

// 表情出现动画：图片加载完成时弹性 pop + 轻微摆动，让表情"蹦"出来更有存在感。
// 一次性动画，仅首帧；reduced-motion 由 useGsap 全局收口。
let appearPlayed = false
useGsap((_ctx, contextSafe) => {
  watch(() => displaySrc.value, contextSafe((src) => {
    if (!src || appearPlayed) return
    appearPlayed = true
    const img = imgRef.value
    if (!img) return
    gsap.fromTo(img,
      { scale: 0.3, rotation: -14, autoAlpha: 0 },
      {
        scale: 1, rotation: 0, autoAlpha: 1,
        duration: 0.5, ease: 'elastic.out(1, 0.55)',
      })
  }), { flush: 'post' })
})

const { isVisible } = useStickerPerformance(rootRef)

const shouldUsePoster = computed(() =>
  Boolean(posterSrc.value) && !isVisible.value
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
  /* 出现动画由 GSAP 弹性 pop 接管（见 useGsap 逻辑），移除 CSS 动画避免双重触发 */
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

@media (prefers-reduced-motion: reduce) {
  .sticker-img {
    transition: none;
  }

  .sticker-inline:hover .sticker-img {
    transform: none;
  }
}
</style>
