<template>
  <div class="privacy-view">
    <div class="header">
      <h2>隐私仪表盘 Privacy Dashboard</h2>
      <p class="header-sub">查看 Maxma 把数据存在哪里、监控了哪些网络活动，并执行清除 / 加密等数据管理操作。</p>
    </div>

    <details class="overview-guide" open>
      <summary>这个页面能帮你做什么？</summary>
      <div class="overview-body">
        <ol>
          <li><strong>数据存储位置</strong>：列出所有本地数据文件，了解你的对话 / 配置 / 密钥 / 日志分别保存在哪里。</li>
          <li><strong>网络活动统计</strong>：当后端审计能力可用时，展示按类型聚合的请求总数与高频目标。</li>
          <li><strong>最近审计日志</strong>：按事件类型筛选并查看最近 50 条审计记录（API 调用 / 文件访问 / 配置变更）。</li>
          <li><strong>数据管理</strong>：清除对话历史、清除审计日志、对 API 密钥做静态加密——操作不可撤销，请谨慎。</li>
        </ol>
        <p class="overview-note">想了解审计能力的整体设计？前往<router-link to="/audit-log">审计日志说明</router-link>。</p>
      </div>
    </details>

    <!-- ── 降级 banner：后端 404 OMP replaces ── -->
    <div v-if="disabled" class="omp-disabled-banner">
      <div class="omp-disabled-title">审计日志功能在 OMP 模式下不可用</div>
      <div class="omp-disabled-detail">
        后端已切换到 OMP（oh-my-pi）架构，审计日志子系统被移除。隐私仪表盘的审计统计与日志区域已隐藏。
        数据存储位置与数据管理仍可用。完整的审计能力说明请见<router-link to="/audit-log">审计日志</router-link>页面。
      </div>
      <div v-if="disabledReason" class="omp-disabled-reason" :title="disabledReason">
        后端响应：{{ disabledReason }}
      </div>
    </div>

    <!-- 数据存储概览（静态，无论是否禁用都显示） -->
    <div class="section">
      <h3>数据存储位置</h3>
      <p class="section-desc">Maxma 采用本地优先架构——所有数据都保存在你自己的机器上，不会上传到任何云端。</p>
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

    <template v-if="!disabled">
      <!-- 审计统计 -->
      <div class="section">
        <h3>网络活动统计</h3>
        <p class="section-desc">展示按事件类型聚合的请求总数与高频目标，帮助确认 AI 行为是否符合预期。</p>
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
        <p class="section-desc">按事件类型筛选并查看最近 50 条审计记录。点击「刷新」获取最新数据。</p>
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
    </template>

    <!-- 数据管理：不依赖 audit-log 后端，无论是否禁用都显示 -->
    <div class="section">
      <h3>数据管理</h3>
      <p class="section-desc">下列操作会直接修改本地数据，<strong>不可撤销</strong>。请确认后再点击。</p>
      <div class="action-row">
        <button class="btn-action" @click="clearHistory" :disabled="actionLoading" title="删除所有会话及其消息，不可恢复">
          清除所有对话历史
        </button>
        <button v-if="!disabled" class="btn-action" @click="clearAuditLog" :disabled="actionLoading" title="清空审计数据库，不影响对话历史与 API 密钥">
          清除审计日志
        </button>
        <button class="btn-action" @click="encryptKeys" :disabled="actionLoading" title="对存储在 providers.yaml 中的 API Key 做静态加密">
          加密 API 密钥
        </button>
      </div>
      <div class="action-hints">
        <div class="action-hint"><strong>清除所有对话历史</strong>：删除全部会话（含临时与已固定）及其消息记录，但保留审计日志、配置、密钥。</div>
        <div class="action-hint"><strong>清除审计日志</strong>：仅清空审计数据库（事件记录），不影响对话历史或密钥。</div>
        <div class="action-hint"><strong>加密 API 密钥</strong>：将 <code>providers.yaml</code> 中明文存储的 API Key 转为加密形式，重启后仍可正常使用。</div>
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

// 后端 404 + OMP replaces 时标记为禁用，UI 显示降级 banner
const disabled = ref(false)
const disabledReason = ref('')

function isOmpDisabledError(msg: string): boolean {
  return /404/.test(msg) && /OMP replaces/i.test(msg)
}

function formatTime(ts: string) {
  if (!ts) return '-'
  const d = new Date(ts)
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

async function loadStats() {
  if (disabled.value) return
  statsLoading.value = true
  try {
    const res = await api.getAuditStats()
    auditStats.value = res.stats
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isOmpDisabledError(msg)) {
      disabled.value = true
      disabledReason.value = msg
    } else {
      // 404/路由未注册等预期内失败降级为 debug，避免污染控制台（降级 banner 已处理用户感知）
      console.debug('Failed to load audit stats:', e)
    }
  } finally {
    statsLoading.value = false
  }
}

async function loadAuditLog() {
  if (disabled.value) return
  logLoading.value = true
  try {
    const params = logFilter.value ? `?event_type=${logFilter.value}&limit=50` : '?limit=50'
    const res = await api.getAuditLog(params)
    auditLog.value = res.records
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isOmpDisabledError(msg)) {
      disabled.value = true
      disabledReason.value = msg
    } else {
      console.debug('Failed to load audit log:', e)
    }
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
	      try { await api.deleteSession(s.session_id) } catch (e: unknown) {
	        console.warn('[PrivacyView] 删除会话失败:', e instanceof Error ? e.message : String(e))
	      }
	    }
    actionMessage.value = `已清除 ${sessions.sessions?.length || 0} 个会话`
    actionMessageType.value = 'ok'
  } catch (e: unknown) {
    actionMessage.value = '清除失败: ' + (e instanceof Error ? e.message : String(e))
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
  } catch (e: unknown) {
    actionMessage.value = '清除失败: ' + (e instanceof Error ? e.message : String(e))
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
  } catch (e: unknown) {
    actionMessage.value = '加密失败: ' + (e instanceof Error ? e.message : String(e))
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
.header h2 { font-size: 20px; font-weight: 600; color: var(--text-primary); margin: 0 0 4px; }
.header-sub { margin: 0; font-size: 13px; color: var(--text-secondary); line-height: 1.6; }

/* ── 总览引导 ── */
.overview-guide {
  margin-bottom: 16px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-card);
  background: color-mix(in srgb, var(--accent) 5%, var(--bg-card));
  border-color: color-mix(in srgb, var(--accent) 25%, var(--border));
}
.overview-guide > summary {
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
  list-style: none;
}
.overview-guide > summary::-webkit-details-marker { display: none; }
.overview-guide > summary::before {
  content: '▸';
  display: inline-block;
  margin-right: 8px;
  color: var(--text-tertiary);
  transition: transform 0.15s;
}
.overview-guide[open] > summary::before { transform: rotate(90deg); }
.overview-body {
  padding: 0 16px 12px;
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.75;
}
.overview-body ol { margin: 6px 0; padding-left: 22px; }
.overview-body li { margin-bottom: 3px; }
.overview-body strong { color: var(--text-primary); }
.overview-note {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-tertiary);
}

.section-desc {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0 0 12px;
}
.section-desc strong { color: var(--text-primary); }

/* ── 数据管理提示 ── */
.action-hints {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.action-hint {
  font-size: 11.5px;
  color: var(--text-tertiary);
  line-height: 1.6;
  padding: 4px 8px;
  border-left: 2px solid var(--border);
  background: var(--bg-primary);
  border-radius: 0 4px 4px 0;
}
.action-hint strong { color: var(--text-secondary); font-weight: 600; }
.action-hint code {
  font-family: 'SF Mono', 'Consolas', monospace;
  font-size: 11px;
  background: var(--bg-secondary);
  padding: 1px 4px;
  border-radius: 3px;
}

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

/* ── 降级 banner ── */
.omp-disabled-banner {
  padding: 16px 18px;
  border: 1px solid var(--status-warn, #eab308);
  border-radius: 10px;
  background: var(--bg-card);
  background: color-mix(in srgb, var(--status-warn, #eab308) 10%, var(--bg-card));
  color: var(--text-primary);
  line-height: 1.6;
  margin-bottom: 16px;
}
.omp-disabled-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--status-warn, #b45309);
  margin-bottom: 4px;
}
.omp-disabled-detail {
  font-size: 13px;
  color: var(--text-secondary);
}
.omp-disabled-reason {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: monospace;
  margin-top: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
