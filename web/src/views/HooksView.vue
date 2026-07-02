<template>
  <div class="hooks-view">
    <!-- ── 标题栏 ── -->
    <div class="header">
      <h2>事件钩子</h2>
      <button v-if="mode === 'list'" class="btn primary" @click="startAdd">+ 添加钩子</button>
      <button v-else class="btn" @click="cancelForm">← 返回列表</button>
    </div>

    <!-- ── 列表模式 ── -->
    <template v-if="mode === 'list'">
      <div v-if="loading" class="loading">加载中...</div>
      <div v-else-if="hooks.length === 0" class="empty">
        尚未配置任何事件钩子。点击上方按钮添加。
        <div class="empty-hint">事件钩子可以在特定条件触发时自动执行 Agent 动作，如文件变更时自动运行测试。</div>
      </div>
      <div v-else class="card-grid">
        <div v-for="h in hooks" :key="h.hook_id" class="hook-card">
          <div class="card-header">
            <div class="card-title-row">
              <span class="card-label">{{ h.name }}</span>
              <span class="type-badge" :class="h.hook_type">{{ typeLabel(h.hook_type) }}</span>
            </div>
            <button
              class="toggle-btn"
              :class="{ active: h.enabled }"
              :title="h.enabled ? '已启用' : '已停用'"
              @click="toggleHook(h.hook_id, !h.enabled)"
            ></button>
          </div>

          <div class="card-action-text">{{ h.action }}</div>

          <div class="card-meta">
            <span class="status-dot" :class="h.status"></span>
            <span class="status-text">{{ statusLabel(h.status) }}</span>
            <span class="meta-sep">·</span>
            <span>触发 {{ h.trigger_count }} 次</span>
            <span v-if="h.last_triggered" class="meta-sep">·</span>
            <span v-if="h.last_triggered">上次: {{ formatTime(h.last_triggered) }}</span>
          </div>

          <div class="card-config" v-if="configSummary(h)">
            <span class="config-text">{{ configSummary(h) }}</span>
          </div>

          <div class="card-actions">
            <button class="action-btn" @click="startEdit(h)">编辑</button>
            <button class="action-btn danger" @click="deleteHook(h.hook_id)">删除</button>
          </div>
        </div>
      </div>

      <!-- 触发历史 -->
      <div v-if="history.length > 0" class="history-section">
        <h3>最近触发记录</h3>
        <div class="history-list">
          <div v-for="r in history" :key="r.trigger_id" class="history-item" :class="r.status">
            <span class="history-time">{{ formatTime(r.timestamp) }}</span>
            <span class="history-type">{{ r.trigger_type }}</span>
            <span class="history-detail">{{ r.trigger_detail }}</span>
            <span class="history-status" :class="r.status">{{ r.status }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- ── 表单模式 ── -->
    <form v-else class="wizard-form" @submit.prevent="handleSave">
      <div class="form-section">
        <label class="form-label">名称</label>
        <input v-model="form.name" class="input" placeholder="例如: 自动测试" required />
      </div>

      <div class="form-section">
        <label class="form-label">钩子类型</label>
        <select v-model="form.hook_type" class="input" :disabled="isEditing" required>
          <option value="file_change">文件变更</option>
          <option value="schedule">定时执行</option>
          <option value="webhook">Webhook</option>
        </select>
      </div>

      <!-- file_change 配置 -->
      <template v-if="form.hook_type === 'file_change'">
        <div class="form-section">
          <label class="form-label">监控路径</label>
          <input v-model="form.config.path" class="input mono" placeholder="例如: D:/Projects/myapp/src" required />
        </div>
        <div class="form-section">
          <label class="form-label">文件模式</label>
          <input v-model="form.config.patterns_str" class="input mono" placeholder="例如: *.py, *.ts" />
          <div class="form-hint">逗号分隔的 glob 模式，默认匹配所有文件</div>
        </div>
        <div class="form-section">
          <label class="form-label">忽略模式</label>
          <input v-model="form.config.ignore_patterns_str" class="input mono" placeholder="例如: __pycache__, *.pyc" />
        </div>
      </template>

      <!-- schedule 配置 -->
      <template v-if="form.hook_type === 'schedule'">
        <div class="form-section">
          <label class="form-label">执行间隔（秒）</label>
          <input v-model.number="form.config.interval" type="number" class="input" min="60" placeholder="3600" required />
          <div class="form-hint">两次执行之间的等待时间，最少 60 秒</div>
        </div>
      </template>

      <!-- webhook 配置 -->
      <template v-if="form.hook_type === 'webhook'">
        <div class="form-section">
          <label class="form-label">Webhook 说明</label>
          <div class="form-hint">通过 POST /api/event-hooks/{hook_id}/trigger 触发此钩子</div>
        </div>
      </template>

      <div class="form-section">
        <label class="form-label">Agent 动作</label>
        <textarea v-model="form.action" class="input textarea" rows="4" placeholder="描述 Agent 应该执行的动作，例如：运行 pytest 并报告测试结果" required></textarea>
      </div>

      <div class="form-actions">
        <button type="button" class="btn" @click="cancelForm">取消</button>
        <button type="submit" class="btn primary" :disabled="saving">{{ saving ? '保存中...' : '保存' }}</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { api } from '@/api'
import { onMounted, ref } from 'vue'

interface HookConfig {
  hook_id: string
  name: string
  hook_type: string
  config: Record<string, any>
  action: string
  status: string
  enabled: boolean
  created_at: number
  last_triggered: number
  trigger_count: number
}

interface HistoryRecord {
  trigger_id: string
  hook_id: string
  timestamp: number
  trigger_type: string
  trigger_detail: string
  status: string
  result: string
}

const mode = ref<'list' | 'form'>('list')
const loading = ref(false)
const saving = ref(false)
const isEditing = ref(false)
const editingId = ref('')
const hooks = ref<HookConfig[]>([])
const history = ref<HistoryRecord[]>([])

const form = ref({
  name: '',
  hook_type: 'file_change',
  config: {
    path: '',
    patterns_str: '',
    ignore_patterns_str: '',
    interval: 3600,
  },
  action: '',
})

function typeLabel(t: string) {
  return { file_change: '文件变更', schedule: '定时', webhook: 'Webhook' }[t] || t
}

function statusLabel(s: string) {
  return { active: '运行中', paused: '已暂停', error: '异常' }[s] || s
}

function formatTime(ts: number) {
  if (!ts) return '-'
  const d = new Date(ts * 1000)
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function configSummary(h: HookConfig) {
  if (h.hook_type === 'file_change') {
    return h.config.path || ''
  }
  if (h.hook_type === 'schedule') {
    return `每 ${h.config.interval || 3600} 秒`
  }
  return ''
}

async function loadHooks() {
  loading.value = true
  try {
    const res = await api.listHooks()
    hooks.value = res.hooks
  } catch (e) {
    console.error('Failed to load hooks:', e)
  } finally {
    loading.value = false
  }
}

async function loadHistory() {
  try {
    const res = await api.getHookHistory()
    history.value = res.history
  } catch (e) {
    console.error('Failed to load history:', e)
  }
}

function startAdd() {
  mode.value = 'form'
  isEditing.value = false
  editingId.value = ''
  form.value = {
    name: '',
    hook_type: 'file_change',
    config: { path: '', patterns_str: '', ignore_patterns_str: '', interval: 3600 },
    action: '',
  }
}

function startEdit(h: HookConfig) {
  mode.value = 'form'
  isEditing.value = true
  editingId.value = h.hook_id
  form.value = {
    name: h.name,
    hook_type: h.hook_type,
    config: {
      path: h.config.path || '',
      patterns_str: (h.config.patterns || []).join(', '),
      ignore_patterns_str: (h.config.ignore_patterns || []).join(', '),
      interval: h.config.interval || 3600,
    },
    action: h.action,
  }
}

function cancelForm() {
  mode.value = 'list'
}

function buildConfig(): Record<string, any> {
  const cfg: Record<string, any> = {}
  if (form.value.hook_type === 'file_change') {
    cfg.path = form.value.config.path
    if (form.value.config.patterns_str) {
      cfg.patterns = form.value.config.patterns_str.split(',').map(s => s.trim()).filter(Boolean)
    }
    if (form.value.config.ignore_patterns_str) {
      cfg.ignore_patterns = form.value.config.ignore_patterns_str.split(',').map(s => s.trim()).filter(Boolean)
    }
  } else if (form.value.hook_type === 'schedule') {
    cfg.interval = Math.max(60, form.value.config.interval || 3600)
  }
  return cfg
}

async function handleSave() {
  saving.value = true
  try {
    if (isEditing.value) {
      await api.updateHook(editingId.value, {
        name: form.value.name,
        config: buildConfig(),
        action: form.value.action,
      })
    } else {
      await api.createHook({
        name: form.value.name,
        hook_type: form.value.hook_type,
        config: buildConfig(),
        action: form.value.action,
      })
    }
    cancelForm()
    await loadHooks()
  } catch (e) {
    console.error('Failed to save hook:', e)
  } finally {
    saving.value = false
  }
}

async function toggleHook(hookId: string, enabled: boolean) {
  try {
    await api.updateHook(hookId, { enabled })
    await loadHooks()
  } catch (e) {
    console.error('Failed to toggle hook:', e)
  }
}

async function deleteHook(hookId: string) {
  if (!confirm('确定删除此钩子？')) return
  try {
    await api.deleteHook(hookId)
    await loadHooks()
    await loadHistory()
  } catch (e) {
    console.error('Failed to delete hook:', e)
  }
}

onMounted(() => {
  loadHooks()
  loadHistory()
})
</script>

<style scoped>
.hooks-view {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
  max-width: 900px;
  margin: 0 auto;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}
.header h2 {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}
.btn {
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
}
.btn:hover { background: var(--bg-secondary); }
.btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.btn.primary:hover { opacity: 0.9; }
.btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }

.loading, .empty {
  text-align: center;
  padding: 48px 0;
  color: var(--text-secondary);
  font-size: 14px;
}
.empty-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  opacity: 0.7;
}

.card-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.hook-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  background: var(--bg-primary);
  transition: border-color 0.15s;
}
.hook-card:hover { border-color: var(--accent-light); }

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 8px;
}
.card-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.card-label {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}
.type-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 100px;
  font-weight: 500;
}
.type-badge.file_change { background: #dbeafe; color: #1d4ed8; }
.type-badge.schedule { background: #fef3c7; color: #b45309; }
.type-badge.webhook { background: #e0e7ff; color: #4338ca; }

.toggle-btn {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  border: none;
  background: var(--border);
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
  flex-shrink: 0;
}
.toggle-btn::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}
.toggle-btn.active { background: var(--accent); }
.toggle-btn.active::after { transform: translateX(16px); }

.card-action-text {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 8px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot.active { background: #22c55e; }
.status-dot.paused { background: #eab308; }
.status-dot.error { background: #ef4444; }
.meta-sep { opacity: 0.4; }

.card-config {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.config-text {
  font-family: monospace;
  opacity: 0.7;
}

.card-actions {
  display: flex;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.action-btn {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}
.action-btn:hover { background: var(--bg-secondary); color: var(--text-primary); }
.action-btn.danger:hover { color: #ef4444; border-color: #ef4444; }

/* 历史记录 */
.history-section {
  margin-top: 32px;
}
.history-section h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px;
}
.history-list {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.history-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
}
.history-item:last-child { border-bottom: none; }
.history-time { color: var(--text-secondary); flex-shrink: 0; }
.history-type {
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--bg-secondary);
  font-size: 11px;
  flex-shrink: 0;
}
.history-detail {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}
.history-status {
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
.history-status.success { color: #22c55e; }
.history-status.error { color: #ef4444; }
.history-status.timeout { color: #eab308; }
.history-status.skipped { color: var(--text-secondary); }

/* 表单 */
.wizard-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.form-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}
.form-hint {
  font-size: 12px;
  color: var(--text-secondary);
  opacity: 0.7;
}
.input {
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-primary);
  outline: none;
  transition: border-color 0.15s;
  font-family: inherit;
}
.input:focus { border-color: var(--accent); }
.input.mono { font-family: monospace; }
.textarea { resize: vertical; min-height: 80px; }
select.input { cursor: pointer; }

.form-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding-top: 8px;
}
</style>
