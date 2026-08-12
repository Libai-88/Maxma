<template>
  <div ref="rootEl" class="sticker-preview-overlay" @click.self="handleClose">
    <button class="preview-close" title="关闭" @click="handleClose">×</button>

    <button
      v-if="canNavigate"
      class="preview-nav left"
      title="上一张"
      @click="go(-1)"
    >
      ‹
    </button>

    <figure ref="cardEl" class="preview-card">
      <div class="preview-image-wrap">
        <img ref="imgRef" :src="current.src" class="preview-img" :alt="current.filename" />
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
import { request } from '@/api'
import { createLogger } from '@/utils/logger'
import { gsap, useGsap, easeMap } from '@/composables/useGsap'

const log = createLogger('StickerPreviewOverlay')

const props = defineProps<{
  stickers: StickerSegment[]
  initialIndex: number
}>()

const emit = defineEmits<{
  close: []
}>()

const currentIndex = ref(
  props.initialIndex >= 0 && props.initialIndex < props.stickers.length
    ? props.initialIndex
    : 0
)
const rootEl = ref<HTMLElement | null>(null)
const cardEl = ref<HTMLElement | null>(null)
const imgRef = ref<HTMLImageElement | null>(null)

// 入场：遮罩淡入 + 卡片弹性缩放入场
useGsap(() => {
  const root = rootEl.value
  const card = cardEl.value
  if (!root) return
  gsap.fromTo(root, { opacity: 0 }, { opacity: 1, duration: 0.16, ease: 'power2.out' })
  if (card) {
    gsap.fromTo(card, { opacity: 0, scale: 0.9, y: 12 }, { opacity: 1, scale: 1, y: 0, duration: 0.24, ease: easeMap.spring })
  }
})
const isFavorited = ref(false)
const favoriteLoading = ref(false)

const current = computed(() => {
  const s = props.stickers[currentIndex.value]
  if (!s) return props.stickers[0] ?? { src: '', category: '', filename: '' } as StickerSegment
  return s
})

watch(() => props.stickers.length, (len) => {
  if (currentIndex.value >= len) {
    currentIndex.value = 0
  }
})
const canNavigate = computed(() => props.stickers.length > 1)

function go(delta: number) {
  if (!props.stickers.length) return
  const next = (currentIndex.value + delta + props.stickers.length) % props.stickers.length
  if (next === currentIndex.value) return
  const img = imgRef.value
  if (img) {
    // 旧图滑出 → 切图 → 新图滑入（交叉过渡）
    gsap.to(img, { opacity: 0, x: delta > 0 ? -20 : 20, duration: 0.12, ease: 'power1.in',
      onComplete: () => {
        currentIndex.value = next
        requestAnimationFrame(() => {
          gsap.fromTo(img, { opacity: 0, x: delta > 0 ? 20 : -20 }, { opacity: 1, x: 0, duration: 0.16, ease: 'power1.out' })
        })
      } })
  } else {
    currentIndex.value = next
  }
}

// 退场：先淡出再 emit，父组件 v-if 卸载不中断动画
function handleClose() {
  const root = rootEl.value
  if (!root) { emit('close'); return }
  gsap.to(root, { opacity: 0, duration: 0.15, ease: 'power2.in', onComplete: () => emit('close') })
}

async function refreshFavoriteStatus() {
  if (!current.value) return
  try {
    // STICKER-AUTH-001：裸 tauriFetch 无 token 会 401，改走 request
    const data = await request<{ favorites: Array<{ category: string; filename: string }> }>('/stickers/favorites')
    const favorites = data.favorites || []
    isFavorited.value = favorites.some(
      (item) => item.category === current.value.category && item.filename === current.value.filename
    )
  } catch (err) {
    log.warn('[StickerPreviewOverlay] 收藏状态读取失败:', err)
  }
}

async function toggleFavorite() {
  if (!current.value || favoriteLoading.value) return
  favoriteLoading.value = true
  try {
    if (isFavorited.value) {
      await request(
        `/stickers/favorites?filename=${encodeURIComponent(current.value.filename)}&category=${encodeURIComponent(current.value.category)}`,
        { method: 'DELETE' }
      )
      isFavorited.value = false
    } else {
      await request('/stickers/favorites', {
        method: 'POST',
        body: JSON.stringify({
          category: current.value.category,
          filename: current.value.filename,
        }),
      })
      isFavorited.value = true
    }
  } catch (err) {
    log.error('[StickerPreviewOverlay] 收藏操作失败:', err)
  } finally {
    favoriteLoading.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') handleClose()
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
    radial-gradient(circle at 50% 35%, color-mix(in srgb, var(--status-warn) 18%, transparent), transparent 34%),
    color-mix(in srgb, var(--text-primary) 72%, transparent);
  -webkit-backdrop-filter: blur(10px);; /* COMPAT-BACKDROP-001：Safari<18 需要前缀 */

  backdrop-filter: blur(10px);;
  cursor: default;
}

.preview-card {
  width: min(520px, 88vw);
  margin: 0;
  border: 1px solid color-mix(in srgb, var(--text-inverse) 18%, transparent);
  border-radius: 24px;
  background: color-mix(in srgb, var(--text-primary) 78%, transparent);
  box-shadow: 0 30px 80px color-mix(in srgb, var(--text-primary) 38%, transparent);
  overflow: hidden;
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
  filter: drop-shadow(0 18px 32px color-mix(in srgb, var(--text-primary) 28%, transparent));
}

.preview-meta {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 14px 16px;
  background: color-mix(in srgb, var(--text-inverse) 8%, transparent);
  color: var(--text-inverse);
}

.preview-category {
  padding: 4px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--status-warn) 18%, transparent);
  color: color-mix(in srgb, var(--status-warn) 15%, var(--bg-raised));
  font-size: 0.82em;
  white-space: nowrap;
}

.preview-filename {
  overflow: hidden;
  color: color-mix(in srgb, var(--text-inverse) 78%, transparent);
  font-size: 0.82em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.favorite-btn {
  border: 1px solid color-mix(in srgb, var(--status-warn) 42%, transparent);
  border-radius: 999px;
  padding: 5px 12px;
  background: color-mix(in srgb, var(--status-warn) 12%, transparent);
  color: color-mix(in srgb, var(--status-warn) 15%, var(--bg-raised));
  cursor: pointer;
}

.favorite-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--status-warn) 22%, transparent);
}

.favorite-btn:disabled {
  opacity: 0.55;
  cursor: wait;
}

.preview-hint {
  margin: 0;
  padding: 0 16px 14px;
  color: color-mix(in srgb, var(--text-inverse) 48%, transparent);
  font-size: 0.76em;
}

.preview-close,
.preview-nav {
  position: fixed;
  border: 1px solid color-mix(in srgb, var(--text-inverse) 20%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-inverse) 10%, transparent);
  color: var(--text-inverse);
  cursor: pointer;
  -webkit-backdrop-filter: blur(8px);; /* COMPAT-BACKDROP-001：Safari<18 需要前缀 */

  backdrop-filter: blur(8px);;
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
  background: color-mix(in srgb, var(--text-inverse) 18%, transparent);
}

/* 入场/退场/切图动画由 GSAP 控制；reduce-motion 由 useGsap 全局 timeScale 收口 */
</style>
