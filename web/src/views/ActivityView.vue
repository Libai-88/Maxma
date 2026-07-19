<!-- web/src/views/ActivityView.vue -->
<template>
  <div class="activity-view">
    <header class="activity-header">
      <div class="activity-header-left">
        <h1>活动中心</h1>
        <p class="header-sub">实时查看 Maxma 内部发生的事件——AI 对话轮次、工具调用、计划、审批等都会在这里出现。</p>
      </div>
      <div class="activity-controls">
        <span
          class="activity-status"
          :class="`status-${store.connectionState}`"
          :title="statusTitle"
        >
          <span class="status-dot" :class="`dot-${store.connectionState}`" aria-hidden="true"></span>
          {{ statusLabel }}
          <span v-if="recentPulse" class="status-pulse" aria-hidden="true">✦ 新事件</span>
        </span>
        <button class="ds-btn ds-btn--sm" @click="store.fetchRecent(100)">刷新</button>
        <button class="ds-btn ds-btn--sm ds-btn--danger" @click="handleClear">清空</button>
      </div>
    </header>

    <!-- Novice 引导：事件类别说明 -->
    <details class="intro-card" open>
      <summary>这是什么页面？事件类别含义说明</summary>
      <div class="intro-body">
        <p>
          活动中心聚合了 Maxma 运行时的所有内部事件，便于排查问题或了解 AI 实际做了什么。
          每条记录显示：时间、类别、消息内容、（若涉及）工具名与会话 ID。
        </p>
        <div class="cat-grid">
          <div class="cat-row"><span class="cat-chip cat-turn">Turn</span><span class="cat-meaning">AI 对话的一轮交互（用户提问 + AI 回复）</span></div>
          <div class="cat-row"><span class="cat-chip cat-tool">工具</span><span class="cat-meaning">AI 调用了一个工具（如文件读写、MCP、搜索等）</span></div>
          <div class="cat-row"><span class="cat-chip cat-plan">计划</span><span class="cat-meaning">AI 制定或更新了执行计划</span></div>
          <div class="cat-row"><span class="cat-chip cat-compression">压缩</span><span class="cat-meaning">上下文超长时被自动压缩以节省 Token</span></div>
          <div class="cat-row"><span class="cat-chip cat-approval">审批</span><span class="cat-meaning">AI 请求执行敏感操作，等待用户批准或已批准/拒绝</span></div>
          <div class="cat-row"><span class="cat-chip cat-memory">记忆</span><span class="cat-meaning">AI 写入或更新了长期记忆（前往「记忆」页面查看）</span></div>
          <div class="cat-row"><span class="cat-chip cat-system">系统</span><span class="cat-meaning">Maxma 自身的事件（启动、重启、配置变更等）</span></div>
        </div>
        <p class="intro-note">
          💡 右上角状态有三种：<strong>连接中</strong>（黄色脉冲，正在建立 SSE 推送）→ <strong>实时</strong>（绿色实心圆，事件发生时立即出现）→ <strong>离线</strong>（灰色空心圆，连接断开，Maxma 每 5 秒轮询一次）。出现「✦ 新事件」标记表示刚刚有事件通过实时连接到达。
        </p>
      </div>
    </details>

    <!-- 统计概览 -->
    <div class="activity-stats" v-if="statsTotal">
      <div class="stat-card">
        <span class="stat-value">{{ statsTotal }}</span>
        <span class="stat-label">总事件</span>
      </div>
      <div class="stat-card" v-for="(count, cat) in statsByCategory" :key="cat">
        <span class="stat-value">{{ count }}</span>
        <span class="stat-label">{{ categoryLabel(cat as string) }}</span>
      </div>
    </div>

    <!-- 事件列表 -->
    <div class="activity-list">
      <div
        v-for="record in displayRecords"
        :key="record.timestamp + '-' + record.event_type + '-' + (record.session_id || record.turn_id || '')"
        class="activity-item"
        :class="`level-${record.level}`"
      >
        <div class="activity-item-time">{{ formatTime(record.timestamp) }}</div>
        <div class="activity-item-category" :class="`cat-${record.category}`">
          {{ categoryLabel(record.category) }}
        </div>
        <div class="activity-item-content">
          <span class="activity-item-message">{{ record.message }}</span>
          <span v-if="record.tool_name" class="activity-item-tool">{{ record.tool_name }}</span>
          <span v-if="record.session_id" class="activity-item-session">{{ record.session_id.slice(0, 8) }}</span>
        </div>
      </div>
      <div v-if="!store.records.length" class="activity-empty">
        <div class="empty-icon">{{ store.connectionState === 'connecting' ? '🔌' : '📋' }}</div>
        <div class="empty-title">{{ store.connectionState === 'connecting' ? '正在建立实时连接...' : '暂无活动记录' }}</div>
        <div class="empty-desc">
          <template v-if="store.connectionState === 'connecting'">
            首次进入页面时正在与后端建立 SSE 推送连接，通常 1-2 秒内完成。
            连接成功后，AI 的内部活动会实时出现在这里。
          </template>
          <template v-else>
            开始一段对话或让 AI 执行任务后，这里会实时显示 AI 的内部活动。
            <router-link to="/" class="empty-link">→ 返回对话</router-link>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useActivityStore } from '@/stores/activity'
import type { ActivityStatsResponse } from '@/types'

const store = useActivityStore()

/** 三态标签：连接中 / 实时 / 离线（轮询） */
const statusLabel = computed(() => {
  switch (store.connectionState) {
    case 'connecting': return '连接中'
    case 'online': return '实时'
    case 'offline': return '离线'
  }
  return ''
})

const statusTitle = computed(() => {
  switch (store.connectionState) {
    case 'connecting': return '正在与后端建立 SSE 推送连接，通常 1-2 秒内完成'
    case 'online': return '已通过 SSE 实时连接接收事件，事件发生时立即出现'
    case 'offline': return '实时连接未建立，正在通过每 5 秒定期轮询获取事件'
  }
  return ''
})

/**
 * 「✦ 新事件」脉冲：当 lastEventAt 在最近 2 秒内变化时显示。
 * 用 watch + setTimeout 自动消退，避免常驻干扰。
 */
const recentPulse = ref(false)
let pulseTimer: ReturnType<typeof setTimeout> | null = null
watch(() => store.lastEventAt, (ts) => {
  if (!ts) return
  recentPulse.value = true
  if (pulseTimer) clearTimeout(pulseTimer)
  pulseTimer = setTimeout(() => { recentPulse.value = false }, 2000)
})

/** 运行时类型守卫：校验后端返回的 stats 结构是否符合 ActivityStatsResponse */
function isActivityStats(data: unknown): data is ActivityStatsResponse {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    typeof d.total === 'number' &&
    typeof d.by_category === 'object' && d.by_category !== null &&
    typeof d.started_at === 'number' &&
    typeof d.uptime_seconds === 'number'
  )
}

const displayRecords = computed(() => [...store.records].reverse())

const safeStats = computed<ActivityStatsResponse>(() => {
  if (isActivityStats(store.stats)) return store.stats
  return { total: 0, by_category: {}, started_at: 0, uptime_seconds: 0 }
})

const statsTotal = computed(() => safeStats.value.total)
const statsByCategory = computed(() => safeStats.value.by_category)

const categoryLabels: Record<string, string> = {
  turn: 'Turn',
  tool: '工具',
  plan: '计划',
  compression: '压缩',
  approval: '审批',
  memory: '记忆',
  system: '系统',
}

function categoryLabel(cat: string): string {
  return categoryLabels[cat] || cat
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}

function handleClear() {
  if (!window.confirm('确定清空当前活动记录吗？此操作不可撤销（不影响审计日志与已保存的会话）。')) return
  store.clear()
}

onMounted(() => {
  store.fetchRecent(100)
  store.fetchStats()
  store.startStream()
})

onUnmounted(() => {
  store.stopStream()
  if (pulseTimer) clearTimeout(pulseTimer)
})
</script>

<style scoped>
.activity-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px;
  overflow: hidden;
}

.activity-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
}

.activity-header-left {
  flex: 1;
  min-width: 0;
}

.activity-header h1 {
  font-size: 1.4em;
  font-family: var(--font-display);
  color: var(--text-primary);
  margin: 0 0 4px;
}

.header-sub {
  margin: 0;
  font-size: 0.82em;
  color: var(--text-secondary);
  line-height: 1.5;
}

.activity-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.activity-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8em;
  color: var(--text-tertiary);
  cursor: help;
  padding: 2px 8px;
  border-radius: 100px;
  background: var(--bg-secondary);
  transition: background 0.2s, color 0.2s;
}
.activity-status.status-online {
  color: var(--status-ok);
  background: color-mix(in srgb, var(--status-ok) 10%, transparent);
}
.activity-status.status-connecting {
  color: var(--status-warn);
  background: color-mix(in srgb, var(--status-warn) 12%, transparent);
}
.activity-status.status-offline {
  color: var(--text-tertiary);
  background: var(--bg-secondary);
}

.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot.dot-online {
  background: var(--status-ok);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--status-ok) 25%, transparent);
}
.status-dot.dot-connecting {
  background: var(--status-warn);
  animation: status-pulse 1.2s ease-in-out infinite;
}
.status-dot.dot-offline {
  background: transparent;
  border: 1.5px solid var(--text-tertiary);
}

@keyframes status-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.1); }
}

.status-pulse {
  margin-left: 4px;
  padding: 0 6px;
  font-size: 0.85em;
  font-weight: 600;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-radius: 100px;
  animation: pulse-fade 2s ease-out;
}

@keyframes pulse-fade {
  0% { opacity: 0; transform: translateY(-2px); }
  15% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0.85; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .status-dot.dot-connecting,
  .status-pulse {
    animation: none;
  }
}

/* ── 引导卡片 ── */
.intro-card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-card);
  margin-bottom: 16px;
}
.intro-card > summary {
  padding: 10px 14px;
  font-size: 0.85em;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
  list-style: none;
  position: relative;
  padding-right: 32px;
}
.intro-card > summary::-webkit-details-marker { display: none; }
.intro-card > summary::after {
  content: '▸';
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-tertiary);
  transition: transform 0.15s;
}
.intro-card[open] > summary::after {
  transform: translateY(-50%) rotate(90deg);
}
.intro-body {
  padding: 0 14px 12px;
  font-size: 0.82em;
  color: var(--text-secondary);
  line-height: 1.6;
}
.intro-body p { margin: 0 0 8px; }
.cat-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}
.cat-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cat-chip {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 100px;
  font-size: 0.85em;
  font-weight: 500;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
  min-width: 56px;
  text-align: center;
}
.cat-chip.cat-tool { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); }
.cat-chip.cat-turn { background: color-mix(in srgb, var(--status-ok) 15%, transparent); color: var(--status-ok); }
.cat-chip.cat-compression { background: color-mix(in srgb, var(--status-warn) 15%, transparent); color: var(--status-warn); }
.cat-chip.cat-approval { background: color-mix(in srgb, var(--status-error) 15%, transparent); color: var(--status-error); }
.cat-meaning {
  color: var(--text-secondary);
}
.intro-note {
  font-size: 0.9em;
  color: var(--text-tertiary);
  margin-top: 8px !important;
}

.activity-stats {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  min-width: 80px;
}

.stat-value {
  font-size: 1.4em;
  font-weight: 600;
  color: var(--accent);
}

.stat-label {
  font-size: 0.75em;
  color: var(--text-tertiary);
  text-transform: uppercase;
}

.activity-list {
  flex: 1;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-card);
}

.activity-item {
	  display: flex;
	  align-items: center;
	  gap: 12px;
	  padding: 10px 14px;
	  border-bottom: 1px solid var(--border);
	  font-size: 0.9em;
	}
.activity-item:last-child {
  border-bottom: none;
}
.activity-item.level-warn {
  background: transparent;
  background: transparent;
  background: color-mix(in srgb, var(--status-warn) 5%, transparent);
}
.activity-item.level-error {
  background: transparent;
  background: transparent;
  background: color-mix(in srgb, var(--status-error) 5%, transparent);
}

.activity-item-time {
  font-family: var(--font-mono, monospace);
  font-size: 0.85em;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.activity-item-category {
  padding: 2px 8px;
  border-radius: 100px;
  font-size: 0.75em;
  font-weight: 500;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  white-space: nowrap;
}
.activity-item-category.cat-tool { background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent); }
.activity-item-category.cat-turn { background: color-mix(in srgb, var(--status-ok) 15%, transparent); color: var(--status-ok); }
.activity-item-category.cat-compression { background: color-mix(in srgb, var(--status-warn) 15%, transparent); color: var(--status-warn); }
.activity-item-category.cat-approval { background: color-mix(in srgb, var(--status-error) 15%, transparent); color: var(--status-error); }

.activity-item-content {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.activity-item-message {
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-item-tool {
  font-family: var(--font-mono, monospace);
  font-size: 0.85em;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  padding: 1px 6px;
  border-radius: 3px;
}

.activity-item-session {
  font-family: var(--font-mono, monospace);
  font-size: 0.75em;
  color: var(--text-tertiary);
}

.activity-empty {
  padding: 48px 32px;
  text-align: center;
  color: var(--text-tertiary);
}
.empty-icon { font-size: 40px; margin-bottom: 12px; }
.empty-title { font-size: 1em; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
.empty-desc { font-size: 0.85em; color: var(--text-tertiary); line-height: 1.6; }
.empty-link {
  color: var(--accent);
  text-decoration: none;
  font-weight: 600;
  margin-left: 4px;
}
.empty-link:hover { text-decoration: underline; }

@media (max-width: 640px) {
  .activity-header { flex-direction: column; align-items: stretch; }
  .activity-controls { justify-content: flex-end; }
  .header-sub { font-size: 0.78em; }
}
</style>
