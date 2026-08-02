<template>
  <div class="flickering-grid" :class="props.class" ref="containerRef">
    <canvas ref="canvasRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{
  class?: string
  squareSize?: number
  gridGap?: number
  color?: string
  maxOpacity?: number
  flickerChance?: number
}>(), {
  squareSize: 4,
  gridGap: 6,
  color: '#60A5FA',
  maxOpacity: 0.3,
  flickerChance: 0.1,
})

const containerRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

let animFrameId = 0
let opacities: number[] = []
let cols = 0
let rows = 0
let resizeObserver: ResizeObserver | null = null

function initGrid() {
  const canvas = canvasRef.value
  const container = containerRef.value
  if (!canvas || !container) return

  const rect = container.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1

  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  canvas.style.width = `${rect.width}px`
  canvas.style.height = `${rect.height}px`

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.scale(dpr, dpr)

  const step = props.squareSize + props.gridGap
  const newCols = Math.floor(rect.width / step)
  const newRows = Math.floor(rect.height / step)
  const total = newCols * newRows

  // Reinitialize opacities if dimensions changed
  if (newCols !== cols || newRows !== rows || opacities.length !== total) {
    cols = newCols
    rows = newRows
    opacities = new Array(total)
    for (let i = 0; i < total; i++) {
      opacities[i] = Math.random() * props.maxOpacity
    }
  }
}

function draw() {
  const canvas = canvasRef.value
  const container = containerRef.value
  if (!canvas || !container) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const rect = container.getBoundingClientRect()
  const step = props.squareSize + props.gridGap

  ctx.clearRect(0, 0, rect.width, rect.height)

  for (let i = 0; i < opacities.length; i++) {
    const row = Math.floor(i / cols)
    const col = i % cols

    // Skip if out of bounds
    if (row >= rows || col >= cols) continue

    const x = col * step
    const y = row * step

    // Flicker: randomly change opacity
    if (Math.random() < props.flickerChance) {
      opacities[i] = Math.random() * props.maxOpacity
    }

    const opacity = opacities[i]
    if (opacity > 0.01) {
      ctx.globalAlpha = opacity
      ctx.fillStyle = props.color
      ctx.fillRect(x, y, props.squareSize, props.squareSize)
    }
  }

  ctx.globalAlpha = 1
}

function animate() {
  draw()
  animFrameId = requestAnimationFrame(animate)
}

function start() {
  initGrid()
  animate()
}

function stop() {
  cancelAnimationFrame(animFrameId)
  animFrameId = 0
}

onMounted(() => {
  const container = containerRef.value
  if (!container) return

  resizeObserver = new ResizeObserver(() => {
    initGrid()
  })
  resizeObserver.observe(container)

  start()
})

onUnmounted(() => {
  stop()
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
})
</script>

<style scoped>
.flickering-grid {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.flickering-grid canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>