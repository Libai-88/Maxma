<template>
  <div class="agent-flow-canvas" ref="canvasEl" @mousedown="handleCanvasMouseDown">
    <div class="flow-viewport" :style="{ transform: `scale(${zoom})` }">
      <svg
        class="flow-svg"
        :width="canvasWidth"
        :height="canvasHeight"
      >
        <!-- 背景网格 -->
        <defs>
          <pattern
            id="grid-pattern"
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r="1" fill="var(--text-tertiary)" opacity="0.3" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid-pattern)" />

      <!-- 连接线 -->
      <g class="connections-layer">
        <path
          v-for="(conn, idx) in connections"
          :key="`conn-${idx}`"
          :d="conn.path"
          :class="['connection-path', `type-${conn.type}`]"
          :style="{ stroke: getConnectionColor(conn) }"
          stroke-width="2"
          fill="none"
          :marker-end="`url(#arrow-${conn.type})`"
        />
      </g>

      <!-- 箭头标记 -->
      <defs>
        <marker
          v-for="type in ['sequential', 'parallel', 'conditional']"
          :key="`arrow-${type}`"
          :id="`arrow-${type}`"
          markerWidth="10"
          markerHeight="10"
          refX="8"
          refY="3"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path
            d="M0,0 L0,6 L9,3 z"
            :style="{ fill: getArrowColor(type) }"
          />
        </marker>
      </defs>
    </svg>

    <!-- Agent节点 -->
    <div class="nodes-layer">
      <div
        v-for="agent in positionedAgents"
        :key="agent.id"
        class="agent-node"
        :class="[
          `status-${agent.status}`,
          { 'is-selected': selectedId === agent.id }
        ]"
        :data-agent-id="agent.id"
        :style="{
          left: `${agent.x}px`,
          top: `${agent.y}px`,
        }"
        role="button"
        tabindex="0"
        :aria-pressed="selectedId === agent.id"
        @click="handleNodeClick(agent.id)"
        @keydown.enter.prevent="handleNodeClick(agent.id)"
        @keydown.space.prevent="handleNodeClick(agent.id)"
      >
        <!-- 节点状态指示器 -->
        <div class="node-status-indicator">
          <div v-if="agent.status === 'running'" class="status-ring"></div>
          <div class="status-dot" :class="`status-${agent.status}`"></div>
        </div>

        <!-- 节点内容 -->
        <div class="node-content">
          <div class="node-icon">
            <Icon v-if="agent.status === 'succeeded'" name="checkmark" :size="16" />
            <Icon v-else-if="agent.status === 'failed'" name="close" :size="16" />
            <Icon v-else-if="agent.status === 'cancelled'" name="ban" :size="16" />
            <span v-else-if="agent.status === 'running'" class="icon-spinner">⟳</span>
            <span v-else>◌</span>
          </div>
          <div class="node-info">
            <div class="node-title">{{ agent.title || `Agent ${agent.id.slice(0, 6)}` }}</div>
            <div class="node-meta">
              <span class="meta-status">{{ getStatusText(agent.status) }}</span>
              <span v-if="agent.progress !== undefined" class="meta-progress">{{ Math.round(agent.progress) }}%</span>
            </div>
          </div>
        </div>

        <!-- 节点操作按钮 -->
        <div class="node-actions" v-if="agent.status === 'running' || agent.status === 'queued'">
          <button
            type="button"
            class="node-action-btn"
            @click.stop="handleCancelNode(agent.id)"
            aria-label="取消任务"
          >
            <Icon name="close" :size="12" />
          </button>
        </div>

        <!-- 进度条 -->
        <div v-if="agent.status === 'running' && agent.progress !== undefined" class="node-progress">
          <div class="progress-fill" :style="{ width: `${agent.progress}%` }"></div>
        </div>
      </div>
    </div>
    </div><!-- /.flow-viewport -->

    <!-- 缩放控制 -->
    <div class="zoom-controls">
      <button type="button" class="zoom-btn" @click="zoomIn" aria-label="放大">
        <Icon name="plus" :size="16" />
      </button>
      <span class="zoom-level">{{ Math.round(zoom * 100) }}%</span>
      <button type="button" class="zoom-btn" @click="zoomOut" aria-label="缩小">
        <Icon name="minus" :size="16" />
      </button>
      <button type="button" class="zoom-btn" @click="resetZoom" aria-label="重置">
        <Icon name="refresh" :size="16" />
      </button>
    </div>

    <!-- 图例 -->
    <div class="flow-legend">
      <div class="legend-item">
        <span class="legend-line sequential"></span>
        <span class="legend-text">顺序执行</span>
      </div>
      <div class="legend-item">
        <span class="legend-line parallel"></span>
        <span class="legend-text">并行执行</span>
      </div>
      <div class="legend-item">
        <span class="legend-line conditional"></span>
        <span class="legend-text">条件执行</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { gsap, useGsap, easeMap } from '@/composables/useGsap'
import Icon from '@/components/Icon.vue'
import type { Agent, AgentDependency } from '@/types/agent'

const props = defineProps<{
  agents: Agent[]
  dependencies: AgentDependency[]
  /** 外部受控的选中项（由编排器持有，列表视图与流程图共享同一份选中态）。 */
  selectedId?: string | null
}>()

const emit = defineEmits<{
  select: [agentId: string]
  cancel: [agentId: string]
}>()

const canvasEl = ref<HTMLElement | null>(null)
const canvasWidth = ref(1000)
const canvasHeight = ref(600)
const zoom = ref(1)
/** 本地选中态；外部给了 selectedId 就以外部为准（受控）。 */
const localSelectedId = ref<string | null>(null)
const selectedId = computed(() =>
  props.selectedId !== undefined ? props.selectedId : localSelectedId.value
)

const NODE_WIDTH = 200
const NODE_HEIGHT = 80
const LAYER_SPACING = 250
const NODE_SPACING = 120

interface PositionedAgent extends Agent {
  x: number
  y: number
  layer: number
}

// 计算节点布局（简单的层级布局算法）
const positionedAgents = computed<PositionedAgent[]>(() => {
  const agentMap = new Map(props.agents.map(a => [a.id, a]))
  const positioned = new Map<string, PositionedAgent>()
  const layers: string[][] = []

  // 计算每个节点的层级（基于依赖关系）
  const getLayer = (agentId: string, visited = new Set<string>()): number => {
    if (visited.has(agentId)) return 0 // 防止循环依赖
    visited.add(agentId)

    const deps = props.dependencies.filter(d => d.to === agentId)
    if (deps.length === 0) return 0

    const maxDepLayer = Math.max(
      ...deps.map(d => getLayer(d.from, new Set(visited)))
    )
    return maxDepLayer + 1
  }

  // 分配层级
  props.agents.forEach(agent => {
    const layer = getLayer(agent.id)
    if (!layers[layer]) layers[layer] = []
    layers[layer].push(agent.id)
  })

  // 计算位置
  layers.forEach((layerAgents, layerIdx) => {
    const layerHeight = layerAgents.length * NODE_SPACING
    const startY = (canvasHeight.value - layerHeight) / 2

    layerAgents.forEach((agentId, nodeIdx) => {
      const agent = agentMap.get(agentId)
      if (agent) {
        positioned.set(agentId, {
          ...agent,
          x: 100 + layerIdx * LAYER_SPACING,
          y: startY + nodeIdx * NODE_SPACING,
          layer: layerIdx,
        })
      }
    })
  })

  return Array.from(positioned.values())
})

// 计算连接线路径
const connections = computed(() => {
  return props.dependencies.map(dep => {
    const fromNode = positionedAgents.value.find(a => a.id === dep.from)
    const toNode = positionedAgents.value.find(a => a.id === dep.to)

    if (!fromNode || !toNode) {
      return { path: '', type: dep.type || 'sequential', from: dep.from, to: dep.to }
    }

    const x1 = fromNode.x + NODE_WIDTH
    const y1 = fromNode.y + NODE_HEIGHT / 2
    const x2 = toNode.x
    const y2 = toNode.y + NODE_HEIGHT / 2

    // 贝塞尔曲线路径
    const cx1 = x1 + (x2 - x1) * 0.5
    const cx2 = x2 - (x2 - x1) * 0.5

    const path = `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`

    return {
      path,
      type: dep.type || 'sequential',
      from: dep.from,
      to: dep.to,
    }
  })
})

function getConnectionColor(conn: { type: string }) {
  const colors = {
    sequential: 'var(--accent)',
    parallel: 'var(--status-info-text)',
    conditional: 'var(--status-warn-text)',
  }
  return colors[conn.type as keyof typeof colors] || colors.sequential
}

function getArrowColor(type: string) {
  const colors = {
    sequential: 'var(--accent)',
    parallel: 'var(--status-info-text)',
    conditional: 'var(--status-warn-text)',
  }
  return colors[type as keyof typeof colors] || colors.sequential
}

function getStatusText(status: string) {
  const labels = {
    queued: '等待',
    running: '运行中',
    succeeded: '完成',
    failed: '失败',
    cancelled: '已取消',
  }
  return labels[status as keyof typeof labels] || status
}

function handleNodeClick(agentId: string) {
  localSelectedId.value = agentId
  emit('select', agentId)
}

function handleCancelNode(agentId: string) {
  emit('cancel', agentId)
}

/**
 * 点击画布空白处取消选中。
 *
 * 监听挂在 `.agent-flow-canvas` 而不是内层 `<svg>`——后者是
 * `pointer-events: none`（连线层不能挡住节点），事件根本到不了它，
 * 于是这个处理函数永远不会触发（jsdom 里因为没有真实命中测试而「看起来」
 * 是好的，浏览器里却是死代码）。
 */
function handleCanvasMouseDown(event: MouseEvent) {
  // 点在节点上时不算「点空白」——节点自己会 stopPropagation。
  if ((event.target as HTMLElement | null)?.closest('.agent-node')) return
  localSelectedId.value = null
  emit('select', '')
}

function zoomIn() {
  zoom.value = Math.min(zoom.value + 0.1, 2)
}

function zoomOut() {
  zoom.value = Math.max(zoom.value - 0.1, 0.5)
}

function resetZoom() {
  zoom.value = 1
}

// 响应式画布大小
function updateCanvasSize() {
  if (!canvasEl.value) return
  const rect = canvasEl.value.getBoundingClientRect()
  canvasWidth.value = rect.width
  canvasHeight.value = Math.max(600, rect.height)
}

// 节点入场动画
//
// watch 回调里的动画必须用 contextSafe 包裹，否则组件卸载时 ctx.revert()
// 撤不掉它们（仓库 useGsap 组合式的既定约定，见其文件头注释）。
//
// 只给**新增**的节点做入场动画：早前的实现对所有节点无差别 fromTo，
// 每当任务数变化，整张图（包括早已存在的节点）都会重新淡入一次。
useGsap((_ctx, contextSafe) => {
  const animatedIds = new Set<string>()

  watch(
    () => positionedAgents.value.map(a => a.id),
    contextSafe((ids: string[]) => {
      const fresh = ids.filter(id => !animatedIds.has(id))
      ids.forEach(id => animatedIds.add(id))
      if (!fresh.length) return

      // flush: 'post' —— 默认的 pre 时机下新节点还没进 DOM，
      // querySelectorAll 拿不到它们。
      const nodes = fresh
        .map(id => canvasEl.value?.querySelector<HTMLElement>(`.agent-node[data-agent-id="${id}"]`))
        .filter((n): n is HTMLElement => Boolean(n))
      if (!nodes.length) return

      gsap.fromTo(
        nodes,
        { opacity: 0, scale: 0.8 },
        {
          opacity: 1,
          scale: 1,
          duration: 0.4,
          stagger: 0.05,
          ease: easeMap.out,
        }
      )
    }),
    { immediate: true, flush: 'post' }
  )
})

// 连接线入场动画
useGsap((_ctx, contextSafe) => {
  watch(
    () => connections.value.length,
    contextSafe(() => {
      const paths = canvasEl.value?.querySelectorAll('.connection-path')
      if (!paths) return

      paths.forEach((path: Element) => {
        // 不是所有环境都实现了 getTotalLength（jsdom 就没有），缺失时
        // 直接放弃这条线的描边动画——它只是装饰，不该让组件挂掉。
        const geometry = path as SVGPathElement
        if (typeof geometry.getTotalLength !== 'function') return
        const length = geometry.getTotalLength()
        if (!Number.isFinite(length) || length <= 0) return

        gsap.fromTo(
          path,
          {
            strokeDasharray: length,
            strokeDashoffset: length,
          },
          {
            strokeDashoffset: 0,
            duration: 0.8,
            ease: easeMap.out,
          }
        )
      })
    }),
    { immediate: true, flush: 'post' }
  )
})

onMounted(() => {
  updateCanvasSize()
  window.addEventListener('resize', updateCanvasSize)
})

// 组件卸载时必须摘掉 resize 监听：否则每次进出该页都会多挂一个监听器，
// 且回调闭包持有已销毁的 DOM 引用。
onUnmounted(() => {
  window.removeEventListener('resize', updateCanvasSize)
})
</script>

<style scoped>
.agent-flow-canvas {
  position: relative;
  width: 100%;
  height: 600px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

/* 缩放视口：网格、连线、节点一起缩放。
   transform-origin 设左上角，使缩放锚定在画布左上角（节点坐标是绝对 px）。 */
.flow-viewport {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  transition: transform 0.2s var(--ease-out);
}

.flow-svg {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}

.connection-path {
  transition: stroke 0.2s ease, stroke-width 0.2s ease;
}

.connection-path:hover {
  stroke-width: 3;
}

.connection-path.type-sequential {
  stroke-dasharray: none;
}

.connection-path.type-parallel {
  stroke-dasharray: 8 4;
}

.connection-path.type-conditional {
  stroke-dasharray: 4 4;
}

/* 节点层 */
.nodes-layer {
  position: relative;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.agent-node {
  position: absolute;
  width: 200px;
  min-height: 80px;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border: 2px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  cursor: pointer;
  pointer-events: all;
  transition: all 0.2s ease;
}

.agent-node:hover {
  border-color: var(--accent);
  box-shadow: 0 4px 16px color-mix(in srgb, var(--accent) 15%, transparent);
  transform: translateY(-2px);
}

.agent-node.is-selected {
  border-color: var(--accent);
  border-width: 3px;
  box-shadow: 0 4px 20px color-mix(in srgb, var(--accent) 25%, transparent);
}

.agent-node.status-running {
  border-color: var(--accent);
}

.agent-node.status-succeeded {
  border-color: var(--status-ok);
}

.agent-node.status-failed {
  border-color: var(--status-error);
}

/* 状态指示器 */
.node-status-indicator {
  position: absolute;
  top: -8px;
  left: -8px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.status-ring {
  position: absolute;
  width: 24px;
  height: 24px;
  border: 2px solid var(--accent);
  border-radius: 50%;
  animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
}

@keyframes ping {
  75%, 100% {
    transform: scale(1.5);
    opacity: 0;
  }
}

.status-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text-tertiary);
  border: 2px solid var(--bg-primary);
}

.status-dot.status-running {
  background: var(--accent-text);
}

.status-dot.status-succeeded {
  background: var(--status-ok-text);
}

.status-dot.status-failed {
  background: var(--status-error-text);
}

.status-dot.status-cancelled {
  background: var(--text-tertiary);
}

/* 节点内容 */
.node-content {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
}

.node-icon {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 18px;
}

.status-succeeded .node-icon {
  background: color-mix(in srgb, var(--status-ok) 15%, var(--bg-secondary));
  color: var(--status-ok-text);
}

.status-failed .node-icon {
  background: color-mix(in srgb, var(--status-error) 15%, var(--bg-secondary));
  color: var(--status-error-text);
}

.status-running .node-icon {
  background: color-mix(in srgb, var(--accent) 15%, var(--bg-secondary));
  color: var(--accent-text);
}

.icon-spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.node-info {
  flex: 1;
  min-width: 0;
}

.node-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 4px;
}

.node-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-secondary);
}

.meta-progress {
  font-family: var(--font-mono);
  font-weight: 600;
}

/* 节点操作 */
.node-actions {
  position: absolute;
  top: 8px;
  right: 8px;
}

.node-action-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.node-action-btn:hover {
  background: var(--status-error-solid);
  border-color: var(--status-error-solid);
  color: var(--status-error-solid-text);
}

/* 进度条 */
.node-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--bg-secondary);
  border-radius: 0 0 6px 6px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 70%, var(--text-primary)));
  transition: width 0.3s ease;
}

/* 缩放控制 */
.zoom-controls {
  position: absolute;
  bottom: 16px;
  left: 16px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow-md);
}

.zoom-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.zoom-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.zoom-level {
  padding: 0 8px;
  font-size: 12px;
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--text-secondary);
}

/* 图例 */
.flow-legend {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow-md);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.legend-line {
  width: 30px;
  height: 2px;
}

.legend-line.sequential {
  background: var(--accent);
}

.legend-line.parallel {
  background: var(--status-info);
  background-image: repeating-linear-gradient(
    90deg,
    var(--status-info),
    var(--status-info) 8px,
    transparent 8px,
    transparent 12px
  );
}

.legend-line.conditional {
  background-image: repeating-linear-gradient(
    90deg,
    var(--status-warn),
    var(--status-warn) 4px,
    transparent 4px,
    transparent 8px
  );
}

.legend-text {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}

/* 响应式 */
@media (max-width: 768px) {
  .agent-flow-canvas {
    height: 500px;
  }

  .agent-node {
    width: 160px;
  }

  .flow-legend {
    font-size: 10px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-node,
  .connection-path,
  .node-action-btn,
  .zoom-btn {
    transition: none;
  }

  .status-ring,
  .icon-spinner {
    animation: none;
  }
}
</style>
