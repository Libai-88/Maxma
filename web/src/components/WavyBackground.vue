<template>
  <canvas
    ref="canvasRef"
    class="wavy-bg"
    :style="{ filter: blurStyle }"
    aria-hidden="true"
  ></canvas>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = withDefaults(
  defineProps<{
    waveWidth?: number
    blur?: number
    speed?: 'slow' | 'fast'
    waveOpacity?: number
    backgroundFill?: string
  }>(),
  {
    waveWidth: 50,
    blur: 10,
    speed: 'fast',
    waveOpacity: 0.5,
    backgroundFill: 'transparent',
  },
)

const blurStyle = computed(() => `blur(${props.blur}px)`)
const canvasRef = ref<HTMLCanvasElement | null>(null)
let animId = 0
let observer: MutationObserver | null = null

interface Wave {
  color: string
  alpha: number
  freq: number    // 频率（波长）
  amp: number     // 振幅
  phase: number   // 相位偏移
  speed: number   // 水平移动速度
  yBase: number   // 垂直基准位置
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ]
}

function setupWaves(): Wave[] {
  const style = getComputedStyle(document.documentElement)
  const accent = style.getPropertyValue('--accent').trim() || '#6e5af0'
  const accentPink = style.getPropertyValue('--accent-pink').trim() || '#e05af0'
  const accentLight = style.getPropertyValue('--accent-light').trim() || accent

  const speedMul = props.speed === 'fast' ? 1 : 0.4
  const baseAlpha = props.waveOpacity
  const ampScale = props.waveWidth / 50  // 以 50 为基准缩放振幅

  return [
    { color: accent,      alpha: baseAlpha * 0.7, freq: 0.008, amp: 28 * ampScale,  phase: 0,       speed: 0.35 * speedMul, yBase: 0.32 },
    { color: accentPink,  alpha: baseAlpha * 0.5, freq: 0.012, amp: 22 * ampScale,  phase: 1.8,     speed: 0.50 * speedMul, yBase: 0.45 },
    { color: accentLight, alpha: baseAlpha * 0.4, freq: 0.006, amp: 35 * ampScale,  phase: 3.2,     speed: 0.28 * speedMul, yBase: 0.38 },
    { color: accent,      alpha: baseAlpha * 0.3, freq: 0.015, amp: 18 * ampScale,  phase: 4.7,     speed: 0.60 * speedMul, yBase: 0.55 },
  ]
}

let waves: Wave[] = []

function draw(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, ts: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = canvas.width / dpr
  const h = canvas.height / dpr
  const time = ts * 0.001

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // 绘制每条波浪
  for (const wave of waves) {
    const yBase = h * wave.yBase
    const offset = time * wave.speed * 60

    ctx.beginPath()
    ctx.moveTo(0, h)

    // 从左到右绘制正弦波路径
    for (let x = 0; x <= w; x += 1) {
      const angle = (x + offset) * wave.freq + wave.phase
      const y = yBase + Math.sin(angle) * wave.amp + Math.sin(angle * 2.3 + 1.2) * wave.amp * 0.3
      ctx.lineTo(x * dpr, y * dpr)
    }

    // 闭合路径到底部
    ctx.lineTo(w * dpr, h)
    ctx.closePath()

    const [r, g, b] = parseHex(wave.color)
    ctx.fillStyle = `rgba(${r},${g},${b},${wave.alpha})`
    ctx.fill()
  }

  animId = requestAnimationFrame((t) => draw(canvas, ctx, t))
}

function resize(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = window.innerWidth
  const h = window.innerHeight
  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'
}

function updateTheme() {
  waves = setupWaves()
}

// ── 生命周期 ──
onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  resize(canvas)
  waves = setupWaves()

  observer = new MutationObserver(updateTheme)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })

  window.addEventListener('resize', () => resize(canvas))

  animId = requestAnimationFrame((t) => draw(canvas, ctx, t))
})

onUnmounted(() => {
  cancelAnimationFrame(animId)
  observer?.disconnect()
  waves = []
})
</script>

<style scoped>
.wavy-bg {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
  transform: translateZ(0);
}
</style>