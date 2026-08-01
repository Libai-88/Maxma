<template>
  <Teleport to="body">
    <Transition name="carousel-fade">
      <div
        v-if="visible"
        class="carousel-overlay"
        @click.self="onClose"
        @mousedown="onPointerDown"
        @mousemove="onPointerMove"
        @mouseup="onPointerUp"
        @mouseleave="onPointerUp"
        @touchstart.prevent="onTouchStart"
        @touchmove.prevent="onTouchMove"
        @touchend="onTouchEnd"
      >
        <div class="carousel-container" ref="containerRef">
          <!-- 3D 舞台 -->
          <div class="carousel-stage" :style="stageStyle">
            <div
              v-for="(item, i) in items"
              :key="i"
              class="carousel-card"
              :class="{ active: activeIndex === i }"
              :style="cardStyle(i)"
              @click.stop="onCardClick(i)"
            >
              <div class="card-inner">
                <div class="card-icon">
                  <Icon :name="item.icon" :size="24" decorative />
                </div>
                <div class="card-title">{{ item.title }}</div>
                <div class="card-subtitle">{{ item.subtitle }}</div>
              </div>
            </div>
          </div>

          <!-- 指示器圆点 -->
          <div class="carousel-dots">
            <span
              v-for="(_, i) in items"
              :key="i"
              class="dot"
              :class="{ active: activeIndex === i }"
              @click="goTo(i)"
            />
          </div>

          <!-- 底部操作栏 -->
          <div v-if="$slots.footer" class="carousel-footer">
            <slot name="footer" />
          </div>

          <!-- 导航箭头 -->
          <button class="nav-arrow nav-prev" @click.stop="rotateStep(-1)" aria-label="上一个">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <button class="nav-arrow nav-next" @click.stop="rotateStep(1)" aria-label="下一个">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>

          <!-- 关闭按钮 -->
          <button class="close-btn" @click.stop="onClose" aria-label="关闭">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import Icon from '@/components/Icon.vue'

export interface CarouselItem {
  icon: string
  title: string
  subtitle: string
  route: string
}

const props = withDefaults(defineProps<{
  items: CarouselItem[]
  visible?: boolean
}>(), {
  visible: false,
})

const emit = defineEmits<{
  select: [item: CarouselItem]
  close: []
}>()

// ── 旋转状态 ──
const currentAngle = ref(0)   // 唯一响应式状态 → 驱动 computed 和渲染
let isDragging = false
let lastX = 0
let velocity = 0
let autoRotateTimer: ReturnType<typeof setTimeout> | null = null
let animFrameId = 0

const itemCount = computed(() => props.items.length)
const stepAngle = computed(() => 360 / itemCount.value)
const activeIndex = computed(() => {
  // 找到最接近正面（0° 附近）的卡片
  let minDist = Infinity
  let idx = 0
  for (let i = 0; i < itemCount.value; i++) {
    const cardAngle = (i * stepAngle.value - currentAngle.value) % 360
    const normalized = ((cardAngle % 360) + 360) % 360
    const dist = Math.min(normalized, 360 - normalized)
    if (dist < minDist) {
      minDist = dist
      idx = i
    }
  }
  return idx
})

const stageStyle = computed(() => ({
  transform: `rotateY(${currentAngle.value}deg)`,
}))

function cardStyle(i: number): Record<string, string> {
  const angle = i * stepAngle.value
  const radius = Math.min(280, 160 + itemCount.value * 8)
  return {
    transform: `rotateY(${angle}deg) translateZ(${radius}px)`,
  }
}

// ── 交互 ──

function onPointerDown(e: MouseEvent) {
  isDragging = true
  lastX = e.clientX
  velocity = 0
  stopAutoRotate()
  cancelAnimationFrame(animFrameId)
}

function onPointerMove(e: MouseEvent) {
  if (!isDragging) return
  const dx = e.clientX - lastX
  currentAngle.value += dx * 0.25
  lastX = e.clientX
  velocity = dx * 0.25
}

function onPointerUp() {
  if (!isDragging) return
  isDragging = false
  if (Math.abs(velocity) > 1) {
    const inertia = () => {
      velocity *= 0.92
      currentAngle.value += velocity
      if (Math.abs(velocity) > 0.5) {
        animFrameId = requestAnimationFrame(inertia)
      } else {
        startAutoRotate()
      }
    }
    animFrameId = requestAnimationFrame(inertia)
  } else {
    startAutoRotate()
  }
}

let touchStartX = 0

function onTouchStart(e: TouchEvent) {
  isDragging = true
  touchStartX = e.touches[0].clientX
  lastX = touchStartX
  velocity = 0
  stopAutoRotate()
  cancelAnimationFrame(animFrameId)
}

function onTouchMove(e: TouchEvent) {
  if (!isDragging) return
  const dx = e.touches[0].clientX - lastX
  currentAngle.value += dx * 0.25
  lastX = e.touches[0].clientX
  velocity = dx * 0.25
}

function onTouchEnd() {
  onPointerUp()
}

// ── 平滑动画（用于 goTo / rotateStep） ──

function animateTo(target: number) {
  cancelAnimationFrame(animFrameId)
  const start = currentAngle.value
  const diff = target - start
  const duration = 450
  const startTime = performance.now()

  function tick(now: number) {
    const elapsed = now - startTime
    const t = Math.min(elapsed / duration, 1)
    // ease-out cubic
    currentAngle.value = start + diff * (1 - Math.pow(1 - t, 3))
    if (t < 1) {
      animFrameId = requestAnimationFrame(tick)
    }
  }
  animFrameId = requestAnimationFrame(tick)
}

function rotateStep(dir: number) {
  stopAutoRotate()
  const target = currentAngle.value + dir * stepAngle.value
  animateTo(target)
  startAutoRotate()
}

function goTo(index: number) {
  const current = currentAngle.value
  const target = index * stepAngle.value
  let diff = target - current
  while (diff > 180) diff -= 360
  while (diff < -180) diff += 360
  stopAutoRotate()
  animateTo(current + diff)
  startAutoRotate()
}

function onCardClick(index: number) {
  goTo(index)
  setTimeout(() => {
    emit('select', props.items[index])
  }, 500)
}

function onClose() {
  emit('close')
}

// ── 自动旋转 ──

function startAutoRotate() {
  stopAutoRotate()
  autoRotateTimer = setTimeout(() => {
    const tick = () => {
      currentAngle.value += 0.15
      autoRotateTimer = setTimeout(tick, 30)
    }
    tick()
  }, 3000)
}

function stopAutoRotate() {
  if (autoRotateTimer) {
    clearTimeout(autoRotateTimer)
    autoRotateTimer = null
  }
}

// ── 键盘支持 ──

function onKeyDown(e: KeyboardEvent) {
  if (!props.visible) return
  if (e.key === 'Escape') onClose()
  if (e.key === 'ArrowLeft') rotateStep(-1)
  if (e.key === 'ArrowRight') rotateStep(1)
  if (e.key === 'Enter' && props.items[activeIndex.value]) {
    emit('select', props.items[activeIndex.value])
  }
}

watch(() => props.visible, (v) => {
  if (v) {
    currentAngle.value = 0
    document.addEventListener('keydown', onKeyDown)
    startAutoRotate()
  } else {
    document.removeEventListener('keydown', onKeyDown)
    stopAutoRotate()
    cancelAnimationFrame(animFrameId)
  }
}, { immediate: true })

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
  stopAutoRotate()
  cancelAnimationFrame(animFrameId)
})
</script>

<style scoped>
/* ── 遮罩层 ── */
.carousel-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  user-select: none;
  cursor: grab;
}
.carousel-overlay:active {
  cursor: grabbing;
}

/* ── 容器 ── */
.carousel-container {
  position: relative;
  width: 100%;
  max-width: 720px;
  height: 420px;
  perspective: 1200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── 3D 舞台 ── */
.carousel-stage {
  position: relative;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── 卡片 ── */
.carousel-card {
  position: absolute;
  width: 160px;
  height: 210px;
  left: 50%;
  top: 50%;
  margin-left: -80px;
  margin-top: -105px;
  backface-visibility: hidden;
  cursor: pointer;
  will-change: transform;
}

.carousel-card.active {
  opacity: 1;
  filter: none;
}

.carousel-card:not(.active) {
  opacity: 0.6;
  filter: brightness(0.45);
}

.card-inner {
  width: 100%;
  height: 100%;
  background: linear-gradient(
    145deg,
    rgba(255, 255, 255, 0.12),
    rgba(255, 255, 255, 0.04)
  );
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 16px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px 16px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
  transition: transform 0.35s ease, box-shadow 0.35s ease, border-color 0.35s ease, background 0.35s ease;
  color: #fff;
  text-align: center;
}

.carousel-card.active .card-inner {
  transform: scale(1.12);
  border-color: rgba(255, 255, 255, 0.45);
  background: linear-gradient(
    145deg,
    rgba(255, 255, 255, 0.2),
    rgba(255, 255, 255, 0.08)
  );
  box-shadow:
    0 0 30px rgba(255, 255, 255, 0.12),
    0 0 60px rgba(255, 255, 255, 0.06),
    0 12px 48px rgba(0, 0, 0, 0.35),
    0 0 0 1px rgba(255, 255, 255, 0.3);
}

.carousel-card:not(.active) .card-inner {
  transform: scale(0.9);
  background: linear-gradient(
    145deg,
    rgba(255, 255, 255, 0.05),
    rgba(255, 255, 255, 0.02)
  );
  border-color: rgba(255, 255, 255, 0.08);
}

.carousel-card.active .card-icon {
  background: rgba(255, 255, 255, 0.18);
  box-shadow: 0 0 20px rgba(255, 255, 255, 0.08);
}

.card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  flex-shrink: 0;
}

.card-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.3;
  color: #fff;
}

.card-subtitle {
  font-size: 11px;
  font-weight: 400;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.6);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ── 指示器 ── */
.carousel-dots {
  position: absolute;
  bottom: -8px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.3);
  cursor: pointer;
  transition: background 0.3s ease, transform 0.3s ease;
}
.dot.active {
  background: #fff;
  transform: scale(1.4);
}

/* ── 导航箭头 ── */
.nav-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s ease, border-color 0.2s ease;
  z-index: 10;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.nav-arrow:hover {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.4);
}
.nav-arrow svg {
  width: 20px;
  height: 20px;
}
.nav-prev { left: 16px; }
.nav-next { right: 16px; }

/* ── 关闭按钮 ── */
.close-btn {
  position: absolute;
  top: 0;
  right: 0;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(0, 0, 0, 0.3);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s ease;
  z-index: 10;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.close-btn:hover {
  background: rgba(255, 255, 255, 0.15);
}
.close-btn svg {
  width: 16px;
  height: 16px;
}

/* ── 入场/退场动画 ── */
.carousel-fade-enter-active {
  transition: opacity 0.3s ease, backdrop-filter 0.3s ease;
}
.carousel-fade-leave-active {
  transition: opacity 0.2s ease;
}
.carousel-fade-enter-from,
.carousel-fade-leave-to {
  opacity: 0;
}

/* ── 底部操作栏 ── */
.carousel-footer {
  position: absolute;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  z-index: 10;
}
</style>