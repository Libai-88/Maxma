<template>
  <div class="sticker-preview-overlay" @click.self="emit('close')">
    <button class="preview-close" title="关闭" @click="emit('close')">×</button>

    <button
      v-if="canNavigate"
      class="preview-nav left"
      title="上一张"
      @click="go(-1)"
    >
      ‹
    </button>

    <figure class="preview-card">
      <div class="preview-image-wrap">
        <img :src="current.src" class="preview-img" :alt="current.filename" />
      </div>
      <figcaption class="preview-meta">
        <span class="preview-category">{{ current.category || '未分类' }}</span>
        <span class="preview-filename" :title="current.filename">{{ current.filename }}</span>
        <button class="favorite-btn" :disabled="favoriteLoading" @click="toggleFavorite">
          {{ isFavorited ? '已收藏' : '收藏' }}
        </button>
      </figcaption>
      <p class="preview-hint">Esc 关闭，← → 切换同条消息中的表情</p>
    </figure>

    <button
      v-if="canNavigate"
      class="preview-nav right"
      title="下一张"
      @click="go(1)"
    >
      ›
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { StickerSegment } from '@/composables/useStickerSegments'
import { getApiBase, tauriFetch } from '@/utils/env'

const props = defineProps<{
  stickers: StickerSegment[]
  initialIndex: number
}>()

const emit = defineEmits<{
  close: []
}>()

const currentIndex = ref(props.initialIndex)
const isFavorited = ref(false)
const favoriteLoading = ref(false)

const current = computed(() => props.stickers[currentIndex.value] ?? props.stickers[0])
const canNavigate = computed(() => props.stickers.length > 1)

function go(delta: number) {
  if (!props.stickers.length) return
  const next = currentIndex.value + delta
  currentIndex.value = (next + props.stickers.length) % props.stickers.length
}

async function refreshFavoriteStatus() {
  if (!current.value) return
  try {
    const res = await tauriFetch(`${getApiBase()}/stickers/favorites`)
    const data = await res.json()
    const favorites = data.favorites || []
    isFavorited.value = favorites.some(
      (item: any) => item.category === current.value.category && item.filename === current.value.filename
    )
  } catch (err) {
    console.warn('[StickerPreviewOverlay] 收藏状态读取失败:', err)
  }
}

async function toggleFavorite() {
  if (!current.value || favoriteLoading.value) return
  favoriteLoading.value = true
  try {
    if (isFavorited.value) {
      await tauriFetch(
        `${getApiBase()}/stickers/favorites?filename=${encodeURIComponent(current.value.filename)}&category=${encodeURIComponent(current.value.category)}`,
        { method: 'DELETE' }
      )
      isFavorited.value = false
    } else {
      await tauriFetch(`${getApiBase()}/stickers/favorites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: current.value.category,
          filename: current.value.filename,
        }),
      })
      isFavorited.value = true
    }
  } catch (err) {
    console.error('[StickerPreviewOverlay] 收藏操作失败:', err)
  } finally {
    favoriteLoading.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
  if (event.key === 'ArrowLeft') go(-1)
  if (event.key === 'ArrowRight') go(1)
}

watch(currentIndex, refreshFavoriteStatus)

onMounted(() => {
  refreshFavoriteStatus()
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.sticker-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
  background:
    radial-gradient(circle at 50% 35%, rgba(255, 245, 230, 0.18), transparent 34%),
    rgba(12, 13, 16, 0.72);
  backdrop-filter: blur(10px);
  cursor: default;
  animation: previewFadeIn 0.16s ease;
}

.preview-card {
  width: min(520px, 88vw);
  margin: 0;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 24px;
  background: rgba(24, 24, 28, 0.78);
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.38);
  overflow: hidden;
  animation: previewScaleIn 0.2s ease;
}

.preview-image-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: min(58vh, 420px);
  padding: 30px;
}

.preview-img {
  max-width: 100%;
  max-height: min(54vh, 390px);
  object-fit: contain;
  filter: drop-shadow(0 18px 32px rgba(0, 0, 0, 0.28));
}

.preview-meta {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 14px 16px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.preview-category {
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 245, 230, 0.18);
  color: #ffe8c2;
  font-size: 0.82em;
  white-space: nowrap;
}

.preview-filename {
  overflow: hidden;
  color: rgba(255, 255, 255, 0.78);
  font-size: 0.82em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.favorite-btn {
  border: 1px solid rgba(255, 232, 194, 0.42);
  border-radius: 999px;
  padding: 5px 12px;
  background: rgba(255, 232, 194, 0.12);
  color: #ffe8c2;
  cursor: pointer;
}

.favorite-btn:hover:not(:disabled) {
  background: rgba(255, 232, 194, 0.22);
}

.favorite-btn:disabled {
  opacity: 0.55;
  cursor: wait;
}

.preview-hint {
  margin: 0;
  padding: 0 16px 14px;
  color: rgba(255, 255, 255, 0.48);
  font-size: 0.76em;
}

.preview-close,
.preview-nav {
  position: fixed;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  cursor: pointer;
  backdrop-filter: blur(8px);
}

.preview-close {
  top: 22px;
  right: 22px;
  width: 38px;
  height: 38px;
  font-size: 1.5em;
  line-height: 1;
}

.preview-nav {
  top: 50%;
  width: 44px;
  height: 44px;
  font-size: 2em;
  transform: translateY(-50%);
}

.preview-nav.left {
  left: 24px;
}

.preview-nav.right {
  right: 24px;
}

.preview-close:hover,
.preview-nav:hover {
  background: rgba(255, 255, 255, 0.18);
}

@keyframes previewFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes previewScaleIn {
  from { opacity: 0; transform: scale(0.94); }
  to { opacity: 1; transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .sticker-preview-overlay,
  .preview-card {
    animation: none;
  }
}
</style>
