<template>
  <div class="thinking-wave-container">
    <canvas
      ref="canvasRef"
      class="thinking-wave-canvas"
      aria-hidden="true"
    ></canvas>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

let animId = 0
let observer: MutationObserver | null = null

interface WaveLayer {
  color: string
  alpha: number
  freq: number
  amp: number
  phase: number
  speed: number
  yBase: number
  glow: boolean
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ]
}

function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = parseHex(hex)
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  let h = 0, s = 0, l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break
      case gn: h = ((bn - rn) / d + 2) / 6; break
      case bn: h = ((rn - gn) / d + 4) / 6; break
    }
  }
  return [h * 360, s * 100, l * 100]
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function setupWaves(): WaveLayer[] {
  const style = getComputedStyle(document.documentElement)
  const accent = style.getPropertyValue('--accent').trim() || '#6e5af0'
  const accentPink = style.getPropertyValue('--accent-pink').trim() || '#e05af0'
  const accentLight = style.getPropertyValue('--accent-light').trim() || accent

  return [
    { color: accent,      alpha: 0.55, freq: 0.015, amp: 10, phase: 0,     speed: 0.5, yBase: 0.45, glow: true },
    { color: accentPink,  alpha: 0.40, freq: 0.022, amp: 7,  phase: 1.8,  speed: 0.7, yBase: 0.55, glow: true },
    { color: accentLight, alpha: 0.30, freq: 0.010, amp: 12, phase: 3.2,  speed: 0.35, yBase: 0.38, glow: false },
    { color: accent,      alpha: 0.20, freq: 0.028, amp: 5,  phase: 4.7,  speed: 0.9, yBase: 0.62, glow: false },
    { color: accentPink,  alpha: 0.15, freq: 0.035, amp: 4,  phase: 0.9,  speed: 1.1, yBase: 0.70, glow: false },
  ]
}

let waves: WaveLayer[] = []

function waveY(x: number, offset: number, wave: WaveLayer): number {
  const angle = (x + offset) * wave.freq + wave.phase
  return wave.amp * (Math.sin(angle) + 0.4 * Math.sin(angle * 2.3 + 1.2) + 0.2 * Math.sin(angle * 4.7 + 0.8))
}

function draw(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, ts: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = canvas.width / dpr
  const h = canvas.height / dpr
  const time = ts * 0.001

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // 呼吸起伏
  const breathe = 1 + 0.08 * Math.sin(time * 0.6)

  // 颜色缓慢漂移
  const hueShift = time * 8

  const baseHues: number[] = []
  for (const wave of waves) {
    const [h, s, l] = hexToHsl(wave.color)
    baseHues.push(h)
  }

  for (let wi = 0; wi < waves.length; wi++) {
    const wave = waves[wi]
    const offset = time * wave.speed * 60
    const yBase = h * wave.yBase + h * 0.12
    const ampScale = breathe

    // 计算整条波浪路径所有点
    const points: { x: number; y: number }[] = []
    for (let x = 0; x <= w; x += 1) {
      const y = waveY(x, offset, wave) * ampScale
      points.push({ x: x * dpr, y: (yBase + y) * dpr })
    }

    // ---- 发光层 ----
    if (wave.glow) {
      const [r, g, b] = parseHex(wave.color)
      const glowAlpha = wave.alpha * 0.35
      for (let pass = 0; pass < 3; pass++) {
        const spread = (pass + 1) * 3
        ctx.beginPath()
        ctx.moveTo(0, h * dpr)
        for (const p of points) {
          ctx.lineTo(p.x, Math.min(p.y + spread, h * dpr))
        }
        ctx.lineTo(w * dpr, h * dpr)
        ctx.closePath()
        ctx.fillStyle = `rgba(${r},${g},${b},${glowAlpha / (pass + 1)})`
        ctx.fill()
      }
    }

    // ---- 颜色渐变填充 ----
    const shiftedHue = (baseHues[wi] + hueShift) % 360
    const color1 = hslToHex(shiftedHue, 70, 55)
    const color2 = hslToHex((shiftedHue + 30) % 360, 60, 60)
    const [r1, g1, b1] = parseHex(color1)
    const [r2, g2, b2] = parseHex(color2)

    ctx.beginPath()
    ctx.moveTo(0, h * dpr)
    for (const p of points) {
      ctx.lineTo(p.x, Math.min(p.y, h * dpr))
    }
    ctx.lineTo(w * dpr, h * dpr)
    ctx.closePath()

    // 渐变填充
    const grad = ctx.createLinearGradient(0, 0, w * dpr, 0)
    grad.addColorStop(0, `rgba(${r1},${g1},${b1},${wave.alpha})`)
    grad.addColorStop(0.5, `rgba(${r2},${g2},${b2},${wave.alpha})`)
    grad.addColorStop(1, `rgba(${r1},${g1},${b1},${wave.alpha * 0.8})`)
    ctx.fillStyle = grad
    ctx.fill()
  }

  // ---- 流动光点（沿波浪峰值闪烁） ----
  for (let wi = 0; wi < waves.length; wi++) {
    const wave = waves[wi]
    const offset = time * wave.speed * 60
    const yBase = h * wave.yBase + h * 0.12
    const ampScale = breathe

    // 在波浪上采样多个光点
    const numSparkles = 6
    for (let s = 0; s < numSparkles; s++) {
      const xPos = ((time * wave.speed * 30 + s * (w / numSparkles)) % w + w) % w
      const yVal = waveY(xPos, offset, wave) * ampScale
      const yPos = (yBase + yVal) * dpr

      // 只在波峰附近出现光点
      const peakFactor = Math.max(0, -yVal / (wave.amp * 1.2))
      if (peakFactor < 0.2) continue

      // 光点闪烁
      const sparkle = peakFactor * (0.5 + 0.5 * Math.sin(time * 3 + s * 1.7 + wi * 2.3))
      const radius = 2 + sparkle * 3

      const [h, sSat, l] = hexToHsl(wave.color)
      const sparkleColor = hslToHex((h + hueShift + 15) % 360, 80, 70)

      ctx.beginPath()
      ctx.arc(xPos * dpr, yPos, radius, 0, Math.PI * 2)
      ctx.fillStyle = sparkleColor
      ctx.globalAlpha = sparkle * 0.6
      ctx.fill()

      // 光晕
      ctx.beginPath()
      ctx.arc(xPos * dpr, yPos, radius * 2.5, 0, Math.PI * 2)
      ctx.fillStyle = sparkleColor
      ctx.globalAlpha = sparkle * 0.15
      ctx.fill()

      ctx.globalAlpha = 1
    }
  }

  animId = requestAnimationFrame((t) => draw(canvas, ctx, t))
}

function resize(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const parent = canvas.parentElement
  if (!parent) return
  const w = parent.offsetWidth
  const h = 48
  canvas.width = w * dpr
  canvas.height = h * dpr
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'
}

const canvasRef = ref<HTMLCanvasElement | null>(null)

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  resize(canvas)
  waves = setupWaves()

  observer = new MutationObserver(() => {
    waves = setupWaves()
  })
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
.thinking-wave-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 48px;
  overflow: hidden;
  border-radius: inherit;
  pointer-events: none;
  z-index: 1;
  mask-image: linear-gradient(to bottom, white 20%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, white 20%, transparent 100%);
}

.thinking-wave-canvas {
  position: absolute;
  top: -12px;
  left: 0;
  width: 100%;
  height: 48px;
}
</style>