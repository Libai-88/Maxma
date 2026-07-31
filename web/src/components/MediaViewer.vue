<!-- web/src/components/MediaViewer.vue -->
<template>
  <Teleport to="body">
    <Transition
      :css="false"
      @before-enter="onBeforeEnter"
      @enter="onEnter"
      @leave="onLeave"
    >
      <div
        v-if="isOpen"
        class="mv-root"
        :class="{ 'mv-controls-hidden': controlsHidden }"
        @click="onBackdropClick"
        @wheel.prevent="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @dblclick="onDoubleClick"
        tabindex="0"
        ref="rootRef"
      >
        <img
          v-if="currentItem"
          ref="imageRef"
          :src="currentItem.src"
          :alt="currentItem.alt || ''"
          class="mv-image"
          draggable="false"
          @click.stop
        />
        <!-- 控件栏 -->
        <div class="mv-controls" @click.stop>
          <button class="mv-btn" @click="prev" :disabled="currentIndex <= 0" title="上一张">‹</button>
          <span class="mv-counter">{{ currentIndex + 1 }} / {{ items.length }}</span>
          <button class="mv-btn" @click="next" :disabled="currentIndex >= items.length - 1" title="下一张">›</button>
          <div class="mv-divider"></div>
          <button class="mv-btn" @click="zoomOut" title="缩小 (−)">−</button>
          <button class="mv-btn" @click="resetView" title="重置 (0)">⊙</button>
          <button class="mv-btn" @click="zoomIn" title="放大 (+)">+</button>
          <div class="mv-divider"></div>
          <button class="mv-btn mv-close" @click="close" title="关闭 (Esc)"><Icon name="close" :size="14" /></button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick, watchEffect } from 'vue'
import { useMediaViewer } from '@/composables/useMediaViewer'
import { useMediaTransform } from '@/composables/useMediaTransform'
import Icon from '@/components/Icon.vue'
import { gsap, useGsap, easeMap } from '@/composables/useGsap'

const { isOpen, currentItem, items, currentIndex, close, next, prev } = useMediaViewer()
const { transform, transformStyle, isDragging, reset, computeFitScale, setScale, onWheel: doWheel, onPointerDown: doPointerDown, onPointerMove: doPointerMove, onPointerUp: doPointerUp, onDoubleClick: doDoubleClick, onKeyZoom } = useMediaTransform()

const rootRef = ref<HTMLElement | null>(null)
const imageRef = ref<HTMLImageElement | null>(null)
const controlsHidden = ref(false)
let idleTimer: ReturnType<typeof setTimeout> | null = null

// CSP-safe CSSOM: set image transform + transition via style.setProperty (was :style binding)
watchEffect(() => {
  const el = imageRef.value
  if (!el) return
  el.style.setProperty('transform', transformStyle.value)
  el.style.setProperty('transition', isDragging.value ? 'none' : 'transform 0.1s ease-out')
}, { flush: 'post' })

function showControls() {
  controlsHidden.value = false
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => { controlsHidden.value = true }, 2500)
}

function onWheel(e: WheelEvent) {
  if (rootRef.value) doWheel(e, rootRef.value)
  showControls()
}
function onPointerDown(e: PointerEvent) { doPointerDown(e); showControls() }
function onPointerMove(e: PointerEvent) { doPointerMove(e); showControls() }
function onPointerUp(e: PointerEvent) { doPointerUp(e) }
function onDoubleClick() {
  const img = rootRef.value?.querySelector('img')
  if (img) {
    const fitScale = computeFitScale(img.naturalWidth, img.naturalHeight, window.innerWidth, window.innerHeight)
    doDoubleClick(fitScale)
  }
}

function onBackdropClick(e: MouseEvent) {
  // 点击背景（非图片、非控件）关闭
  if (e.target === e.currentTarget) close()
}

function zoomIn() { setScale(transform.value.scale * 1.2); showControls() }
function zoomOut() { setScale(transform.value.scale / 1.2); showControls() }
function resetView() { reset(); showControls() }

function onKeydown(e: KeyboardEvent) {
  if (!isOpen.value) return
  switch (e.key) {
    case 'Escape': close(); break
    case 'ArrowLeft': prev(); break
    case 'ArrowRight': next(); break
    case '+': case '=': zoomIn(); break
    case '-': zoomOut(); break
    case '0': resetView(); break
    default: onKeyZoom(e.key)
  }
  showControls()
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  if (idleTimer) clearTimeout(idleTimer)
})

// 打开时重置变换 + 聚焦
watch(isOpen, (open) => {
  if (open) {
    reset()
    showControls()
    nextTick(() => rootRef.value?.focus())
  }
})

// 切换图片时重置变换 + 新图淡入
watch(currentIndex, () => {
  reset()
  const img = imageRef.value
  if (img) gsap.fromTo(img, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: easeMap.out })
})

// ── 打开/关闭过渡：root 淡入淡出 + 图片淡入（不触碰 transform，避免与 CSSOM 状态冲突） ──
let onBeforeEnter = (_el: Element) => {}
let onEnter = (_el: Element, done: () => void) => done()
let onLeave = (_el: Element, done: () => void) => done()

useGsap((_ctx, contextSafe) => {
  function beforeEnter(el: Element) {
    gsap.set(el, { opacity: 0 })
  }
  function enter(el: Element, done: () => void) {
    gsap.to(el, { opacity: 1, duration: 0.22, ease: 'power2.out', onComplete: done })
    const img = (el as HTMLElement).querySelector('img')
    if (img) gsap.fromTo(img, { opacity: 0 }, { opacity: 1, duration: 0.28, ease: easeMap.out })
  }
  function leave(el: Element, done: () => void) {
    gsap.to(el, { opacity: 0, duration: 0.18, ease: 'power2.in', onComplete: done })
  }
  onBeforeEnter = contextSafe(beforeEnter)
  onEnter = contextSafe(enter)
  onLeave = contextSafe(leave)
})
</script>

<style scoped>
.mv-root {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  outline: none;
}
.mv-root:active { cursor: grabbing; }

.mv-image {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  user-select: none;
  pointer-events: none;
  transform-origin: center center;
  will-change: transform;
}

.mv-controls {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(30, 30, 30, 0.85);
  border-radius: 100px;
  backdrop-filter: blur(12px);
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.mv-controls-hidden .mv-controls {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
  pointer-events: none;
}

.mv-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: rgba(255, 255, 255, 0.85);
  font-size: 1.2em;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.mv-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
}
.mv-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.mv-close { font-size: 1em; }

.mv-counter {
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.85em;
  font-variant-numeric: tabular-nums;
  padding: 0 4px;
  min-width: 50px;
  text-align: center;
}

.mv-divider {
  width: 1px;
  height: 20px;
  background: rgba(255, 255, 255, 0.2);
  margin: 0 4px;
}

/* 打开/关闭/切图动画由 GSAP JS 过渡钩子控制（:css=false）；缩放仍由 CSSOM transform 管理 */
</style>
