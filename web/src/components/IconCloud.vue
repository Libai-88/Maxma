<template>
  <canvas
    ref="canvasRef"
    class="icon-cloud"
    aria-hidden="true"
  ></canvas>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{
  iconCount?: number
}>(), {
  iconCount: 24,
})

interface Particle {
  x: number
  y: number
  z: number
  label: string
  color: string
  iconChar: string
}

const brandColors: Record<string, string> = {
  typescript: '#3178C6',
  javascript: '#F7DF1E',
  python: '#3776AB',
  rust: '#DEA584',
  react: '#61DAFB',
  vue: '#4FC08D',
  svelte: '#FF3E00',
  tailwind: '#06B6D4',
  flutter: '#02569B',
  dart: '#0175C2',
  nodejs: '#339933',
  nextjs: '#000000',
  docker: '#2496ED',
  kubernetes: '#326CE5',
  git: '#F05032',
  github: '#181717',
  postgresql: '#4169E1',
  firebase: '#FFCA28',
  nginx: '#009639',
  vercel: '#000000',
  vscode: '#007ACC',
  figma: '#F24E1E',
  deno: '#70FFAF',
  bun: '#FBF0DF',
}

const iconData = Object.entries(brandColors).map(([slug, color]) => {
  const label = slug.charAt(0).toUpperCase() + slug.slice(1, 2)
  return { slug, color, label, iconChar: label }
})

const canvasRef = ref<HTMLCanvasElement | null>(null)
let animId = 0
let particles: Particle[] = []
let sphereR = 40
let rotationX = 0.3
let rotationY = 0.8
let isDragging = false
let lastMX = 0
let lastMY = 0
let velocityX = 0
let velocityY = 0
let currentDpr = 1

function initParticles(count: number, R: number): Particle[] {
  const items = iconData.slice(0, count)
  const result: Particle[] = []

  for (let i = 0; i < items.length; i++) {
    const goldenRatio = (1 + Math.sqrt(5)) / 2
    const theta = Math.acos(1 - 2 * (i + 0.5) / items.length)
    const phi = 2 * Math.PI * i / goldenRatio

    result.push({
      x: R * Math.sin(theta) * Math.cos(phi),
      y: R * Math.sin(theta) * Math.sin(phi),
      z: R * Math.cos(theta),
      label: items[i].label,
      color: items[i].color,
      iconChar: items[i].iconChar,
    })
  }
  return result
}

function draw(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, ts: number) {
  const dpr = currentDpr
  const w = canvas.offsetWidth
  const h = canvas.offsetHeight
  const cx = w / 2
  const cy = h / 2
  const time = ts * 0.001

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.scale(dpr, dpr)

  // 自动旋转 + 惯性
  if (!isDragging) {
    rotationY += 0.004
    rotationX += 0.0008 + 0.0004 * Math.sin(time * 0.3)
  } else {
    velocityX *= 0.93
    velocityY *= 0.93
    rotationY += velocityX
    rotationX += velocityY
  }

  const cosX = Math.cos(rotationX)
  const sinX = Math.sin(rotationX)
  const cosY = Math.cos(rotationY)
  const sinY = Math.sin(rotationY)

  // 投影
  const projected = particles.map(p => {
    let x1 = p.x * cosY - p.z * sinY
    let z1 = p.x * sinY + p.z * cosY
    let y1 = p.y
    let y2 = y1 * cosX - z1 * sinX
    let z2 = y1 * sinX + z1 * cosX

    const scale = 550 / (550 + z2)
    return {
      ...p,
      px: cx + x1 * scale,
      py: cy + y2 * scale,
      scale,
      z: z2,
    }
  })

  // 按 z 排序（远的先画）
  projected.sort((a, b) => a.z - b.z)

  const R = sphereR
  for (const p of projected) {
    const size = 18 * p.scale
    const depth = (p.z + R) / (2 * R)
    const alpha = Math.max(0.2, depth)

    // 前方图标的发光光晕
    if (p.z > 0) {
      const glowSize = size * 2
      const grad = ctx.createRadialGradient(p.px, p.py, 0, p.px, p.py, glowSize)
      grad.addColorStop(0, `rgba(255,255,255,${alpha * 0.15})`)
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(p.px, p.py, glowSize, 0, Math.PI * 2)
      ctx.fill()
    }

    // 品牌色圆形背景
    ctx.beginPath()
    ctx.arc(p.px, p.py, size / 2 + 2, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255,255,255,${alpha * 0.85})`
    ctx.fill()

    // 品牌色圆点
    ctx.beginPath()
    ctx.arc(p.px, p.py, size / 2 - 1, 0, Math.PI * 2)
    ctx.fillStyle = p.color
    ctx.globalAlpha = alpha
    ctx.fill()
    ctx.globalAlpha = 1

    // 文字
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.fillStyle = p.color === '#F7DF1E' || p.color === '#FFCA28' || p.color === '#FBF0DF' || p.color === '#70FFAF'
      ? '#333'
      : '#fff'
    ctx.font = `bold ${Math.round(9 * p.scale)}px "Inter", "Segoe UI", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(p.iconChar, p.px, p.py + 0.5)
    ctx.restore()
  }

  ctx.restore()

  animId = requestAnimationFrame((t) => draw(canvas, ctx, t))
}

function resize(canvas: HTMLCanvasElement) {
  currentDpr = Math.min(window.devicePixelRatio || 1, 2)
  const parent = canvas.parentElement
  if (!parent) return
  const size = parent.offsetWidth || 110
  canvas.style.width = size + 'px'
  canvas.style.height = size + 'px'
  canvas.width = size * currentDpr
  canvas.height = size * currentDpr
  sphereR = size * 0.38
}

function onPointerDown(e: PointerEvent) {
  isDragging = true
  lastMX = e.clientX
  lastMY = e.clientY
  const canvas = canvasRef.value
  if (canvas) canvas.setPointerCapture(e.pointerId)
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging) return
  const dx = e.clientX - lastMX
  const dy = e.clientY - lastMY
  velocityX = dx * 0.005
  velocityY = dy * 0.005
  rotationY += velocityX
  rotationX += velocityY
  lastMX = e.clientX
  lastMY = e.clientY
}

function onPointerUp() {
  isDragging = false
}

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // 先测量父容器尺寸再初始化
  resize(canvas)
  particles = initParticles(props.iconCount, sphereR)

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointerleave', onPointerUp)

  animId = requestAnimationFrame((t) => draw(canvas, ctx, t))
})

onUnmounted(() => {
  cancelAnimationFrame(animId)
  const canvas = canvasRef.value
  if (canvas) {
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointerleave', onPointerUp)
  }
  particles = []
})
</script>

<style scoped>
.icon-cloud {
  display: block;
  border-radius: 50%;
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.icon-cloud:active {
  cursor: grabbing;
}
</style>