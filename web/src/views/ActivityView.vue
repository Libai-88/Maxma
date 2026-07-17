<!-- web/src/views/ActivityView.vue -->
<template>
  <div class="activity-view">
    <header class="activity-header">
      <h1>活动中心</h1>
      <div class="activity-controls">
        <span class="activity-status" :class="{ online: store.connected }">
          {{ store.connected ? '● 实时' : '○ 离线' }}
        </span>
        <button class="ds-btn ds-btn--sm" @click="store.fetchRecent(100)">刷新</button>
        <button class="ds-btn ds-btn--sm ds-btn--danger" @click="store.clear">清空</button>
      </div>
    </header>

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
        v-for="(record, idx) in displayRecords"
        :key="idx"
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
        暂无活动记录
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useActivityStore } from '@/stores/activity'
import type { ActivityStatsResponse } from '@/types'

const store = useActivityStore()

const displayRecords = computed(() => [...store.records].reverse())

const statsTotal = computed(() => (store.stats as ActivityStatsResponse).total || 0)
const statsByCategory = computed(() => (store.stats as ActivityStatsResponse).by_category || {})

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

onMounted(() => {
  store.fetchRecent(100)
  store.fetchStats()
  store.startStream()
})

onUnmounted(() => {
  store.stopStream()
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
  align-items: center;
  margin-bottom: 16px;
}

.activity-header h1 {
  font-size: 1.4em;
  font-family: var(--font-display);
  color: var(--text-primary);
  margin: 0;
}

.activity-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.activity-status {
  font-size: 0.8em;
  color: var(--text-tertiary);
}
.activity-status.online {
  color: var(--status-ok);
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
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 0.85em;
}
.activity-item:last-child {
  border-bottom: none;
}
.activity-item.level-warn {
  background: color-mix(in srgb, var(--status-warn) 5%, transparent);
}
.activity-item.level-error {
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
  padding: 32px;
  text-align: center;
  color: var(--text-tertiary);
}
</style>
