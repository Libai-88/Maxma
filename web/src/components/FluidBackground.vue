<template>
  <canvas
    ref="canvasRef"
    class="fluid-bg"
    aria-hidden="true"
  ></canvas>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

// ── 类型 ──
interface Blob {
  x: number; y: number
  vx: number; vy: number
  tx: number; ty: number
  radius: number
  color: [number, number, number]
  alpha: number
  phase: number   // 形态动画相位偏移
}

// ── 暗色主题 ──
const DARK_THEMES = ['midnight', 'night']

function isDarkTheme(): boolean {
  const theme = document.documentElement.getAttribute('data-theme')
  return DARK_THEMES.includes(theme || '')
}

function themeParams(dark: boolean) {
  return {
    alphas: dark ? [0.045, 0.038, 0.032, 0.025] : [0.10, 0.085, 0.07, 0.055],
  }
}

// ── 状态 ──
const canvasRef = ref<HTMLCanvasElement | null>(null)
let animId = 0
let observer: MutationObserver | null = null
const BLOB_COUNT = 4
const blobs: Blob[] = []

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ]
}

function newTarget(b: Blob, w: number, h: number) {
  b.tx = 100 + Math.random() * (w - 200)
  b.ty = 100 + Math.random() * (h - 200)
}

function setup(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = window.innerWidth
  const h = window.innerHeight
  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'

  // 读取主题色
  const style = getComputedStyle(document.documentElement)
  const accent = style.getPropertyValue('--accent').trim() || '#6e5af0'
  const accentPink = style.getPropertyValue('--accent-pink').trim() || '#e05af0'
  const c1 = parseHex(accent)
  const c2 = parseHex(accentPink)

  const dark = isDarkTheme()
  const { alphas } = themeParams(dark)
  const colors: [number, number, number][] = [c1, c2, c1, c2]
  const radii = [320, 260, 200, 160]

  for (let i = 0; i < BLOB_COUNT; i++) {
    const x = (w / (BLOB_COUNT + 1)) * (i + 1)
    const y = (h / (BLOB_COUNT + 1)) * (i + 1)
    const b: Blob = {
      x, y, vx: 0, vy: 0,
      tx: x, ty: y,
      radius: radii[i],
      color: colors[i % colors.length],
      alpha: alphas[i],
      phase: (i / BLOB_COUNT) * Math.PI * 2,
    }
    newTarget(b, w, h)
    blobs.push(b)
  }
}

function updateTheme() {
  const dark = isDarkTheme()
  const { alphas } = themeParams(dark)
  blobs.forEach((b, i) => {
    b.alpha = alphas[i % alphas.length]
  })
}

// ── 绘制有机贝塞尔形态（无 blur） ──
function drawOrganicBlob(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  baseR: number,
  time: number,
  phase: number,
) {
  const numPoints = 10
  const pts: { x: number; y: number }[] = []

  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2
    // 多频率叠加 → 自然有机起伏
    const variance =
      Math.sin(angle * 3 + time * 0.35 + phase) * 0.18 +
      Math.cos(angle * 2 + time * 0.25 + phase * 1.3) * 0.12 +
      Math.sin(angle * 5 + time * 0.15 + phase * 0.7) * 0.06
    const r = baseR * (1.0 + variance)
    pts.push({
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    })
  }

  // 用 cubic bezier 连接成平滑闭合曲线
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)

  for (let i = 0; i < numPoints; i++) {
    const cur = pts[i]
    const next = pts[(i + 1) % numPoints]
    const prev = pts[(i - 1 + numPoints) % numPoints]
    const nnext = pts[(i + 2) % numPoints]

    const cp1x = cur.x + (next.x - prev.x) * 0.15
    const cp1y = cur.y + (next.y - prev.y) * 0.15
    const cp2x = next.x - (nnext.x - cur.x) * 0.15
    const cp2y = next.y - (nnext.y - cur.y) * 0.15

    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, next.x, next.y)
  }

  ctx.closePath()
}

function animate(ts: number, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number) {
  const time = ts * 0.001 // seconds

  // ── 更新物理位置 ──
  for (const b of blobs) {
    const dx = b.tx - b.x
    const dy = b.ty - b.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.001

    if (dist < 20) newTarget(b, w, h)

    const steerX = (dx / dist) * 0.35
    const steerY = (dy / dist) * 0.35
    b.vx += (steerX - b.vx * 0.08) * 0.015
    b.vy += (steerY - b.vy * 0.08) * 0.015

    b.vx *= 0.97
    b.vy *= 0.97

    b.x += b.vx
    b.y += b.vy

    const margin = b.radius * 0.5
    if (b.x < -margin) { b.x = -margin; b.vx *= -0.5 }
    if (b.x > w + margin) { b.x = w + margin; b.vx *= -0.5 }
    if (b.y < -margin) { b.y = -margin; b.vy *= -0.5 }
    if (b.y > h + margin) { b.y = h + margin; b.vy *= -0.5 }
  }

  // ── 绘制 ──
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  for (const b of blobs) {
    const cx = b.x * dpr
    const cy = b.y * dpr
    const r = b.radius * dpr
    const [cr, cg, cb] = b.color
    const alpha = b.alpha

    // 径向渐变填充
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    grad.addColorStop(0, `rgba(${cr},${cg},${cb},${alpha})`)
    grad.addColorStop(0.4, `rgba(${cr},${cg},${cb},${alpha * 0.6})`)
    grad.addColorStop(0.75, `rgba(${cr},${cg},${cb},${alpha * 0.2})`)
    grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)

    ctx.fillStyle = grad
    drawOrganicBlob(ctx, cx, cy, r, time, b.phase)
    ctx.fill()
  }

  animId = requestAnimationFrame((t) => animate(t, canvas, ctx, w, h, dpr))
}

// ── 生命周期 ──
onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = window.innerWidth
  const h = window.innerHeight

  setup(canvas)

  observer = new MutationObserver(updateTheme)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })

  animId = requestAnimationFrame((t) => animate(t, canvas, ctx, w, h, dpr))
})

onUnmounted(() => {
  cancelAnimationFrame(animId)
  observer?.disconnect()
  blobs.length = 0
})
</script>

<style scoped>
.fluid-bg {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
  transform: translateZ(0);
}
</style>