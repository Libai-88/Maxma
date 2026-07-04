<template>
  <svg
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    class="sparkline"
    preserveAspectRatio="none"
  >
    <!-- 基线 -->
    <line
      v-if="showBaseline"
      :x1="0" :y1="baselineY" :x2="width" :y2="baselineY"
      class="sparkline-baseline"
    />
    <!-- 折线 -->
    <polyline
      v-if="points.length >= 2"
      :points="linePoints"
      class="sparkline-line"
      fill="none"
    />
    <!-- 填充区域 -->
    <polygon
      v-if="points.length >= 2 && fill"
      :points="areaPoints"
      class="sparkline-area"
    />
    <!-- 末端点 -->
    <circle
      v-if="points.length >= 1"
      :cx="lastPoint.x" :cy="lastPoint.y"
      :r="dotRadius"
      class="sparkline-dot"
    />
    <text
      v-if="points.length < 2"
      :x="width / 2" :y="height / 2"
      text-anchor="middle" dominant-baseline="middle"
      class="sparkline-empty"
    >无数据</text>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  data: number[]
  width?: number
  height?: number
  fill?: boolean
  showBaseline?: boolean
  /** 已知 Y 轴最大值（用于多图对齐），不传则自适应 */
  maxY?: number
  /** 已知 Y 轴最小值 */
  minY?: number
}>(), {
  width: 120,
  height: 32,
  fill: true,
  showBaseline: true,
})

const dotRadius = 2.5
const padding = 2

const points = computed(() => {
  const data = props.data
  if (!data || data.length === 0) return []
  const n = data.length
  const min = props.minY !== undefined ? props.minY : Math.min(...data)
  const max = props.maxY !== undefined ? props.maxY : Math.max(...data)
  const range = max - min || 1
  const usableH = props.height - padding * 2
  const usableW = props.width - padding * 2
  const stepX = n > 1 ? usableW / (n - 1) : 0
  return data.map((v, i) => {
    const x = padding + i * stepX
    const y = padding + usableH * (1 - (v - min) / range)
    return { x, y, v }
  })
})

const linePoints = computed(() =>
  points.value.map(p => `${p.x},${p.y}`).join(' '),
)

const areaPoints = computed(() => {
  if (points.value.length < 2) return ''
  const pts = points.value
  const first = `${pts[0].x},${props.height - padding}`
  const last = `${pts[pts.length - 1].x},${props.height - padding}`
  return [first, ...pts.map(p => `${p.x},${p.y}`), last].join(' ')
})

const lastPoint = computed(() =>
  points.value.length > 0 ? points.value[points.value.length - 1] : { x: 0, y: 0 },
)

const baselineY = computed(() => props.height - padding)
</script>

<style scoped>
.sparkline {
  display: block;
}
.sparkline-baseline {
  stroke: var(--border);
  stroke-width: 0.5;
  stroke-dasharray: 2 2;
}
.sparkline-line {
  stroke: var(--accent);
  stroke-width: 1.5;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.sparkline-area {
  fill: var(--accent);
  fill-opacity: 0.12;
}
.sparkline-dot {
  fill: var(--accent);
}
.sparkline-empty {
  fill: var(--text-tertiary);
  font-size: 9px;
}
</style>
