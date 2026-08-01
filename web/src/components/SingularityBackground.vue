<template>
  <canvas
    ref="canvasRef"
    class="singularity-bg"
    aria-hidden="true"
  ></canvas>
</template>

<script lang="ts">
import { useDialKit, type DialKitConfig } from '../composables/useDialKit'
const __dialKitDefaults = useDialKit()
</script>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

interface Props extends Partial<DialKitConfig> {
  noise?: {
    opacity: number
    scale: number
  }
}

const props = withDefaults(defineProps<Props>(), {
  hue: __dialKitDefaults.hue,
  saturation: __dialKitDefaults.saturation,
  brightness: __dialKitDefaults.brightness,
  speed: __dialKitDefaults.speed,
  mouseSensitivity: __dialKitDefaults.mouseSensitivity,
  damping: __dialKitDefaults.damping,
  noise: () => ({ opacity: __dialKitDefaults.noise.opacity, scale: __dialKitDefaults.noise.scale }),
})

const canvasRef = ref<HTMLCanvasElement | null>(null)

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  phase: number
  orbitRadius: number
  orbitSpeed: number
  orbitAngle: number
  alpha: number
}

let particles: Particle[] = []
let animId = 0
let mouseX = 0
let mouseY = 0
let mouseIn = false
let currentDpr = 1
let elapsed = 0
const MAX_PARTICLES = 160

function hsl(h: number, s: number, l: number, a: number): string {
  return `hsla(${h}, ${s}%, ${l}%, ${a})`
}

function initParticles(w: number, h: number) {
  const cx = w / 2
  const cy = h / 2
  const maxR = Math.min(w, h) * 0.48
  particles = []
  for (let i = 0; i < MAX_PARTICLES; i++) {
    const angle = Math.random() * Math.PI * 2
    const r = Math.random() * maxR
    particles.push({
      x: cx + Math.cos(angle) * Math.random() * maxR,
      y: cy + Math.sin(angle) * Math.random() * maxR,
      vx: 0,
      vy: 0,
      size: 0.5 + Math.random() * 2.5,
      phase: Math.random() * Math.PI * 2,
      orbitRadius: r,
      orbitSpeed: (0.15 + Math.random() * 0.85) * 0.003,
      orbitAngle: angle,
      alpha: 0.2 + Math.random() * 0.8,
    })
  }
}

function draw(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, _ts: number) {
  const dpr = currentDpr
  const w = canvas.offsetWidth
  const h = canvas.offsetHeight
  const cx = w / 2
  const cy = h / 2

  const { hue, saturation, brightness, speed, noise: noiseOpt } = props
  const dt = 16
  elapsed += dt * speed

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.scale(dpr, dpr)

  const maxR = Math.min(w, h) * 0.48
  const noiseScale = noiseOpt?.scale ?? 1
  const noiseOpacity = noiseOpt?.opacity ?? 0.3

  // --- 1. 中央核心光晕 ---
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.5)
  const pulse = 0.85 + 0.15 * Math.sin(elapsed * 0.002)
  coreGrad.addColorStop(0, hsl(hue, saturation, Math.min(98, brightness + 30), 0.7 * pulse))
  coreGrad.addColorStop(0.2, hsl(hue, saturation, Math.min(95, brightness + 15), 0.35 * pulse))
  coreGrad.addColorStop(0.5, hsl(hue, saturation, brightness, 0.12 * pulse))
  coreGrad.addColorStop(1, hsl(hue, saturation, brightness, 0))
  ctx.fillStyle = coreGrad
  ctx.beginPath()
  ctx.arc(cx, cy, maxR * 0.5, 0, Math.PI * 2)
  ctx.fill()

  // --- 2. 外层环光晕 ---
  const ringGrad = ctx.createRadialGradient(cx, cy, maxR * 0.55, cx, cy, maxR)
  ringGrad.addColorStop(0, hsl(hue, saturation, brightness, 0))
  ringGrad.addColorStop(0.6, hsl(hue, saturation, Math.min(90, brightness + 10), 0.04))
  ringGrad.addColorStop(1, hsl(hue, saturation, Math.min(85, brightness + 5), 0.12))
  ctx.fillStyle = ringGrad
  ctx.beginPath()
  ctx.arc(cx, cy, maxR, 0, Math.PI * 2)
  ctx.fill()

  // --- 3. 更新并绘制粒子 ---
  for (const p of particles) {
    // 轨道运动
    p.orbitAngle += p.orbitSpeed * (elapsed * 0.001)

    // 噪声位移
    const noiseX = Math.sin(p.phase + elapsed * 0.0006 * noiseScale) * maxR * 0.06 * noiseOpacity
    const noiseY = Math.cos(p.phase * 1.3 + elapsed * 0.0005 * noiseScale) * maxR * 0.06 * noiseOpacity

    // 目标位置
    let tx = cx + Math.cos(p.orbitAngle) * p.orbitRadius + noiseX
    let ty = cy + Math.sin(p.orbitAngle) * p.orbitRadius + noiseY

    // 鼠标交互
    if (mouseIn) {
      const dx = mouseX - tx
      const dy = mouseY - ty
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < maxR * 0.7) {
        const force = (1 - dist / (maxR * 0.7)) * props.mouseSensitivity * 2
        tx -= dx * force * 0.08
        ty -= dy * force * 0.08
      }
    }

    // 弹簧阻尼运动
    p.vx += (tx - p.x) * 0.06
    p.vy += (ty - p.y) * 0.06
    p.vx *= props.damping
    p.vy *= props.damping
    p.x += p.vx
    p.y += p.vy

    // 中心距离归一化
    const dist = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2)
    const distNorm = Math.min(1, dist / maxR)

    // 粒子大小随距离变化
    const size = p.size * (0.4 + 0.6 * (1 - distNorm))

    // 颜色随位置偏移
    const angle = Math.atan2(p.y - cy, p.x - cx)
    const hueShift = Math.sin(angle + elapsed * 0.0003) * 25
    const particleHue = ((hue + hueShift) % 360 + 360) % 360
    const particleSat = Math.max(0, saturation - distNorm * 25)
    const particleLit = Math.min(95, brightness + 25 - distNorm * 30)
    const alpha = p.alpha * (1 - distNorm * 0.4)

    // 较大粒子发光
    if (p.size > 1.5) {
      const glowGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 5)
      glowGrad.addColorStop(0, hsl(particleHue, particleSat, particleLit, alpha * 0.12))
      glowGrad.addColorStop(1, hsl(particleHue, particleSat, particleLit, 0))
      ctx.fillStyle = glowGrad
      ctx.beginPath()
      ctx.arc(p.x, p.y, size * 5, 0, Math.PI * 2)
      ctx.fill()
    }

    // 粒子本体
    ctx.fillStyle = hsl(particleHue, particleSat, particleLit, alpha)
    ctx.beginPath()
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2)
    ctx.fill()
  }

  // --- 4. 中心亮核 ---
  const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.12)
  coreGlow.addColorStop(0, `rgba(255,255,255,${0.35 * pulse})`)
  coreGlow.addColorStop(0.5, `rgba(255,255,255,${0.1 * pulse})`)
  coreGlow.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = coreGlow
  ctx.beginPath()
  ctx.arc(cx, cy, maxR * 0.12, 0, Math.PI * 2)
  ctx.fill()

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
  initParticles(size, size)
}

function onPointerMove(e: PointerEvent) {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  mouseX = (e.clientX - rect.left) / (rect.width / canvas.offsetWidth)
  mouseY = (e.clientY - rect.top) / (rect.height / canvas.offsetHeight)
  mouseIn = true
}

function onPointerLeave() {
  mouseIn = false
}

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  resize(canvas)

  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerleave', onPointerLeave)

  animId = requestAnimationFrame((t) => draw(canvas, ctx, t))
})

onUnmounted(() => {
  cancelAnimationFrame(animId)
  const canvas = canvasRef.value
  if (canvas) {
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerleave', onPointerLeave)
  }
  particles = []
})
</script>

<style scoped>
.singularity-bg {
  display: block;
  border-radius: 50%;
  user-select: none;
  touch-action: none;
  pointer-events: auto;
}
</style>