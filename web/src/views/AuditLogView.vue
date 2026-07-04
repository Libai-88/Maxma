<template>
  <div class="audit-view">
    <div class="header">
      <h2>审计日志</h2>
      <div class="header-actions">
        <span v-if="loading" class="badge-muted">加载中…</span>
        <span v-else-if="error" class="badge-error" :title="error">获取失败</span>
        <span v-else class="badge-muted">共 {{ stats.total }} 条</span>
        <button class="btn-small" @click="refresh">刷新</button>
      </div>
    </div>

    <!-- 统计区 -->
    <section class="card">
      <h3>统计</h3>
      <div class="stat-grid">
        <div class="stat">
          <div class="stat-value">{{ stats.total }}</div>
          <div class="stat-label">总记录数</div>
        </div>
        <div class="stat" v-for="(count, type) in stats.by_type" :key="`type-${type}`">
          <div class="stat-value">{{ count }}</div>
          <div class="stat-label">{{ type }}</div>
        </div>
        <div class="stat" v-for="(count, status) in stats.by_status" :key="`status-${status}`">
          <div class="stat-value" :class="statusClass(status)">{{ count }}</div>
          <div class="stat-label">{{ status }}</div>
        </div>
      </div>
      <div v-if="stats.top_targets?.length > 0" class="sub-section">
        <div class="sub-title">高频目标 Top {{ stats.top_targets.length }}</div>
        <BarChartMini :items="topTargetItems" :height="160" />
      </div>
    </section>

    <!-- 过滤栏 -->
    <section class="card">
      <h3>日志记录</h3>
      <div class="filter-row">
        <select v-model="filterType" @change="loadRecords">
          <option value="">全部类型</option>
          <option v-for="t in availableTypes" :key="t" :value="t">{{ t }}</option>
        </select>
        <input
          v-model="filterSince"
          type="date"
          class="date-input"
          @change="loadRecords"
        />
        <select v-model="filterLimit" @change="loadRecords">
          <option :value="50">最近 50 条</option>
          <option :value="100">最近 100 条</option>
          <option :value="200">最近 200 条</option>
          <option :value="500">最近 500 条</option>
        </select>
        <button class="btn-small" @click="loadRecords">应用</button>
      </div>

      <!-- 日志列表 -->
      <div v-if="loading && records.length === 0" class="loading-text">加载中…</div>
      <div v-else-if="records.length === 0" class="empty-text">暂无日志记录</div>
      <div v-else class="log-list">
        <div v-for="(entry, idx) in records" :key="idx" class="log-entry" :class="`status-${entry.status}`">
          <div class="log-row">
            <span class="log-time">{{ formatTime(entry.timestamp) }}</span>
            <span class="log-type" :class="`type-${entry.type}`">{{ entry.type }}</span>
            <span class="log-status" :class="`status-${entry.status}`">{{ entry.status }}</span>
            <span v-if="entry.data_size > 0" class="log-size">{{ formatSize(entry.data_size) }}</span>
          </div>
          <div class="log-target" :title="entry.target">{{ entry.target || '—' }}</div>
          <div v-if="entry.detail" class="log-detail">{{ entry.detail }}</div>
          <div v-if="entry.extra && Object.keys(entry.extra).length > 0" class="log-extra">
            <code>{{ JSON.stringify(entry.extra) }}</code>
          </div>
        </div>
      </div>
    </section>

    <!-- 操作区 -->
    <section class="card">
      <h3>数据管理</h3>
      <div class="action-row">
        <button class="btn-action danger" :disabled="actionLoading" @click="handleClear">
          {{ actionLoading ? '处理中…' : '清空审计日志' }}
        </button>
        <button class="btn-action" :disabled="actionLoading" @click="handleEncrypt">
          {{ actionLoading ? '处理中…' : '加密 API 密钥' }}
        </button>
      </div>
      <div v-if="actionMessage" class="action-message" :class="actionMessageType">
        {{ actionMessage }}
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuditLogStore } from '@/stores/auditLog'
import BarChartMini from '@/components/BarChartMini.vue'

const auditStore = useAuditLogStore()
const { records, stats, loading, error } = storeToRefs(auditStore)

const filterType = ref('')
const filterSince = ref('')
const filterLimit = ref(100)
const actionLoading = ref(false)
const actionMessage = ref('')
const actionMessageType = ref<'ok' | 'error'>('ok')

const availableTypes = computed(() => {
  const types = Object.keys(stats.value.by_type || {})
  return types.sort()
})

const topTargetItems = computed(() =>
  (stats.value.top_targets || []).map(t => ({
    label: t.target,
    value: t.count,
  })),
)

async function loadRecords() {
  await auditStore.loadRecords({
    limit: filterLimit.value,
    eventType: filterType.value,
    since: filterSince.value || '',
  })
  await auditStore.loadStats()
}

async function refresh() {
  await auditStore.refreshAll({
    limit: filterLimit.value,
    eventType: filterType.value,
    since: filterSince.value || '',
  })
}

async function handleClear() {
  if (!confirm('确定清空所有审计日志？此操作不可恢复。')) return
  actionLoading.value = true
  actionMessage.value = ''
  try {
    const deleted = await auditStore.clearAll()
    actionMessage.value = `已清空 ${deleted} 条记录`
    actionMessageType.value = 'ok'
  } catch (e: any) {
    actionMessage.value = `清空失败: ${e?.message || String(e)}`
    actionMessageType.value = 'error'
  } finally {
    actionLoading.value = false
  }
}

async function handleEncrypt() {
  actionLoading.value = true
  actionMessage.value = ''
  try {
    const count = await auditStore.encryptKeys()
    actionMessage.value = `已加密 ${count} 个 API 密钥`
    actionMessageType.value = 'ok'
  } catch (e: any) {
    actionMessage.value = `加密失败: ${e?.message || String(e)}`
    actionMessageType.value = 'error'
  } finally {
    actionLoading.value = false
  }
}

function formatTime(ts: string): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ts
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`
}

function statusClass(status: string): string {
  if (status === 'ok') return 'text-ok'
  if (status === 'error') return 'text-error'
  if (status === 'blocked') return 'text-warn'
  return ''
}

onMounted(() => {
  refresh()
})
</script>

<style scoped>
.audit-view {
  padding: 24px 32px;
  max-width: 1100px;
  margin: 0 auto;
  overflow-y: auto;
  height: 100%;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
}
.header h2 {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--text-secondary);
}
.badge-muted {
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 12px;
}
.badge-error {
  padding: 2px 8px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--status-error) 12%, transparent);
  color: var(--status-error);
  font-size: 12px;
}
.btn-small {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}
.btn-small:hover { border-color: var(--accent); color: var(--text-primary); }

.card {
  margin-bottom: 16px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-card);
}
.card h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.stat {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-primary);
  text-align: center;
}
.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}
.stat-value.text-ok { color: #22c55e; }
.stat-value.text-error { color: var(--status-error); }
.stat-value.text-warn { color: var(--status-warn); }
.stat-label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.sub-section { margin-top: 12px; }
.sub-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.filter-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
  align-items: center;
}
.filter-row select,
.date-input {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
}

.log-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 500px;
  overflow-y: auto;
}
.log-entry {
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--bg-primary);
  border-left: 3px solid var(--border);
}
.log-entry.status-ok { border-left-color: #22c55e; }
.log-entry.status-error { border-left-color: var(--status-error); }
.log-entry.status-blocked { border-left-color: var(--status-warn); }
.log-row {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  flex-wrap: wrap;
}
.log-time {
  color: var(--text-secondary);
  font-family: monospace;
  flex-shrink: 0;
}
.log-type {
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--bg-secondary);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
}
.log-status {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 3px;
}
.log-status.status-ok { color: #22c55e; background: color-mix(in srgb, #22c55e 12%, transparent); }
.log-status.status-error { color: var(--status-error); background: color-mix(in srgb, var(--status-error) 12%, transparent); }
.log-status.status-blocked { color: var(--status-warn); background: color-mix(in srgb, var(--status-warn) 12%, transparent); }
.log-size {
  color: var(--text-tertiary);
  font-size: 11px;
  font-family: monospace;
}
.log-target {
  font-size: 12px;
  color: var(--text-primary);
  margin-top: 2px;
  font-family: monospace;
  word-break: break-all;
}
.log-detail {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}
.log-extra {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
}
.log-extra code {
  font-family: monospace;
  background: var(--bg-secondary);
  padding: 2px 4px;
  border-radius: 3px;
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.btn-action {
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-action:hover:not(:disabled) { border-color: var(--accent); }
.btn-action.danger { color: var(--status-error); }
.btn-action.danger:hover:not(:disabled) {
  border-color: var(--status-error);
  background: color-mix(in srgb, var(--status-error) 8%, var(--bg-card));
}
.btn-action:disabled { opacity: 0.5; cursor: not-allowed; }

.action-message {
  margin-top: 8px;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 6px;
}
.action-message.ok {
  color: #22c55e;
  background: color-mix(in srgb, #22c55e 10%, var(--bg-card));
}
.action-message.error {
  color: var(--status-error);
  background: color-mix(in srgb, var(--status-error) 10%, var(--bg-card));
}

.loading-text, .empty-text {
  color: var(--text-secondary);
  font-size: 13px;
  padding: 16px 0;
  text-align: center;
}
</style>
