<template>
  <div class="privacy-view">
    <div class="header">
      <h2>隐私仪表盘</h2>
    </div>

    <!-- 数据存储概览 -->
    <div class="section">
      <h3>数据存储位置</h3>
      <div class="storage-grid">
        <div class="storage-card" v-for="item in storageItems" :key="item.label">
          <div class="storage-icon">{{ item.icon }}</div>
          <div class="storage-info">
            <div class="storage-label">{{ item.label }}</div>
            <div class="storage-path">{{ item.path }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 审计统计 -->
    <div class="section">
      <h3>网络活动统计</h3>
      <div v-if="statsLoading" class="loading-text">加载中...</div>
      <div v-else-if="auditStats.total === 0" class="empty-text">暂无审计记录</div>
      <div v-else class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">{{ auditStats.total }}</div>
          <div class="stat-label">总请求数</div>
        </div>
        <div class="stat-card" v-for="(count, type) in auditStats.by_type" :key="type">
          <div class="stat-value">{{ count }}</div>
          <div class="stat-label">{{ type }}</div>
        </div>
      </div>
      <div v-if="auditStats.top_targets?.length" class="top-targets">
        <h4>高频目标</h4>
        <div class="target-list">
          <div v-for="t in auditStats.top_targets" :key="t.target" class="target-item">
            <span class="target-name">{{ t.target }}</span>
            <span class="target-count">{{ t.count }} 次</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 审计日志 -->
    <div class="section">
      <h3>最近审计日志</h3>
      <div class="log-controls">
        <select v-model="logFilter" class="log-filter" @change="loadAuditLog">
          <option value="">全部类型</option>
          <option value="api_call">API 调用</option>
          <option value="file_access">文件访问</option>
          <option value="config_change">配置变更</option>
        </select>
        <button class="btn-small" @click="loadAuditLog">刷新</button>
      </div>
      <div v-if="logLoading" class="loading-text">加载中...</div>
      <div v-else-if="auditLog.length === 0" class="empty-text">暂无日志</div>
      <div v-else class="log-list">
        <div v-for="(entry, idx) in auditLog" :key="idx" class="log-entry" :class="entry.status">
          <span class="log-time">{{ formatTime(entry.timestamp) }}</span>
          <span class="log-type">{{ entry.type }}</span>
          <span class="log-target">{{ entry.target }}</span>
          <span class="log-status" :class="entry.status">{{ entry.status }}</span>
        </div>
      </div>
    </div>

    <!-- 操作 -->
    <div class="section">
      <h3>数据管理</h3>
      <div class="action-row">
        <button class="btn-action" @click="clearHistory" :disabled="actionLoading">
          清除所有对话历史
        </button>
        <button class="btn-action" @click="clearAuditLog" :disabled="actionLoading">
          清除审计日志
        </button>
        <button class="btn-action" @click="encryptKeys" :disabled="actionLoading">
          加密 API 密钥
        </button>
      </div>
      <div v-if="actionMessage" class="action-message" :class="actionMessageType">
        {{ actionMessage }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '@/api'

interface StorageItem {
  icon: string
  label: string
  path: string
}

const storageItems: StorageItem[] = [
  { icon: '🧠', label: '长期记忆', path: 'config/personas/memory.yaml' },
  { icon: '💬', label: '对话历史', path: 'api/data/const-sessions/' },
  { icon: '🔑', label: '提供商配置', path: 'api/data/providers.yaml' },
  { icon: '🔧', label: 'MCP 配置', path: 'api/data/mcp_servers.yaml' },
  { icon: '📋', label: '环境变量', path: '.env' },
  { icon: '📁', label: '路径白名单', path: 'api/data/path_whitelist.yaml' },
  { icon: '📝', label: '审计日志', path: 'logs/audit.jsonl' },
  { icon: '📊', label: '上传文件', path: 'uploads/' },
]

const auditStats = ref<{ total: number; by_type: Record<string, number>; by_status: Record<string, number>; top_targets: Array<{ target: string; count: number }> }>({
  total: 0, by_type: {}, by_status: {}, top_targets: [],
})
const statsLoading = ref(false)
const logFilter = ref('')
const auditLog = ref<any[]>([])
const logLoading = ref(false)
const actionLoading = ref(false)
const actionMessage = ref('')
const actionMessageType = ref<'ok' | 'error'>('ok')

function formatTime(ts: string) {
  if (!ts) return '-'
  const d = new Date(ts)
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

async function loadStats() {
  statsLoading.value = true
  try {
    const res = await api.getAuditStats()
    auditStats.value = res.stats
  } catch (e) {
    console.error('Failed to load audit stats:', e)
  } finally {
    statsLoading.value = false
  }
}

async function loadAuditLog() {
  logLoading.value = true
  try {
    const params = logFilter.value ? `?event_type=${logFilter.value}&limit=50` : '?limit=50'
    const res = await api.getAuditLog(params)
    auditLog.value = res.records
  } catch (e) {
    console.error('Failed to load audit log:', e)
  } finally {
    logLoading.value = false
  }
}

async function clearHistory() {
  if (!confirm('确定清除所有对话历史？此操作不可恢复。')) return
  actionLoading.value = true
  actionMessage.value = ''
  try {
    const sessions = await api.listSessions()
    for (const s of sessions.sessions || []) {
      try { await api.deleteSession(s.session_id) } catch {}
    }
    actionMessage.value = `已清除 ${sessions.sessions?.length || 0} 个会话`
    actionMessageType.value = 'ok'
  } catch (e: any) {
    actionMessage.value = '清除失败: ' + (e?.message || String(e))
    actionMessageType.value = 'error'
  } finally {
    actionLoading.value = false
  }
}

async function clearAuditLog() {
  if (!confirm('确定清除所有审计日志？')) return
  actionLoading.value = true
  actionMessage.value = ''
  try {
    const res = await api.clearAuditLog()
    actionMessage.value = `已清除 ${res.deleted} 条审计记录`
    actionMessageType.value = 'ok'
    await loadStats()
    await loadAuditLog()
  } catch (e: any) {
    actionMessage.value = '清除失败: ' + (e?.message || String(e))
    actionMessageType.value = 'error'
  } finally {
    actionLoading.value = false
  }
}

async function encryptKeys() {
  actionLoading.value = true
  actionMessage.value = ''
  try {
    const res = await api.encryptApiKeys()
    actionMessage.value = `已加密 ${res.encrypted} 个 API 密钥`
    actionMessageType.value = 'ok'
  } catch (e: any) {
    actionMessage.value = '加密失败: ' + (e?.message || String(e))
    actionMessageType.value = 'error'
  } finally {
    actionLoading.value = false
  }
}

onMounted(() => {
  loadStats()
  loadAuditLog()
})
</script>

<style scoped>
.privacy-view {
  padding: 24px 32px;
  max-width: 900px;
  margin: 0 auto;
  overflow-y: auto;
  height: 100%;
}
.header { margin-bottom: 24px; }
.header h2 { font-size: 20px; font-weight: 600; color: var(--text-primary); margin: 0; }

.section {
  margin-bottom: 24px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-card);
}
.section h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px;
}
.section h4 {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 12px 0 8px;
}

.storage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 8px;
}
.storage-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-primary);
}
.storage-icon { font-size: 20px; flex-shrink: 0; }
.storage-label { font-size: 13px; font-weight: 500; color: var(--text-primary); }
.storage-path { font-size: 11px; color: var(--text-secondary); font-family: monospace; }

.stats-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.stat-card {
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-primary);
  text-align: center;
  min-width: 80px;
}
.stat-value { font-size: 20px; font-weight: 700; color: var(--text-primary); }
.stat-label { font-size: 11px; color: var(--text-secondary); margin-top: 2px; }

.top-targets { margin-top: 12px; }
.target-list { display: flex; flex-direction: column; gap: 4px; }
.target-item {
  display: flex;
  justify-content: space-between;
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 4px;
  background: var(--bg-primary);
}
.target-name { color: var(--text-primary); font-family: monospace; }
.target-count { color: var(--text-secondary); }

.log-controls {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.log-filter {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
}
.btn-small {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}
.btn-small:hover { border-color: var(--accent); color: var(--text-primary); }

.log-list { display: flex; flex-direction: column; gap: 2px; max-height: 300px; overflow-y: auto; }
.log-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 4px;
  background: var(--bg-primary);
}
.log-time { color: var(--text-secondary); flex-shrink: 0; font-family: monospace; }
.log-type {
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--bg-secondary);
  font-size: 11px;
  flex-shrink: 0;
}
.log-target { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); }
.log-status { font-size: 11px; font-weight: 600; flex-shrink: 0; }
.log-status.ok { color: #22c55e; }
.log-status.error { color: #ef4444; }
.log-status.blocked { color: #eab308; }

.action-row { display: flex; flex-wrap: wrap; gap: 8px; }
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
.btn-action:disabled { opacity: 0.5; cursor: not-allowed; }

.action-message {
  margin-top: 8px;
  font-size: 13px;
  padding: 6px 12px;
  border-radius: 6px;
}
.action-message.ok { color: #22c55e; background: color-mix(in srgb, #22c55e 10%, var(--bg-card)); }
.action-message.error { color: var(--status-error); background: color-mix(in srgb, var(--status-error) 10%, var(--bg-card)); }

.loading-text, .empty-text {
  color: var(--text-secondary);
  font-size: 13px;
  padding: 12px 0;
}
</style>
