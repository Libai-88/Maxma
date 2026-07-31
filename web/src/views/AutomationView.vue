<template>
  <div class="automation-view" ref="rootEl">
    <div class="header">
      <h2>自动化 AUTOMATION</h2>
      <p class="header-sub">定时任务与自动化调度</p>
    </div>

    <!-- 创建表单 -->
    <div class="section create-section">
      <div class="create-row">
        <input v-model="form.name" type="text" placeholder="任务名称" class="form-input" />
        <input v-model="form.schedule" type="text" placeholder="Cron 表达式 (如 0 9 * * *)" class="form-input" />
        <input v-model="form.action" type="text" placeholder="执行动作" class="form-input flex-2" />
        <button class="btn btn-primary" @click="handleCreate" :disabled="!canCreate">创建</button>
      </div>
    </div>

    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="error" class="error-banner">{{ error }}</div>
    <template v-else>
      <div v-if="automations.length === 0" class="empty">
        <div class="empty-icon">⏰</div>
        <div class="empty-title">暂无自动化任务</div>
        <div class="empty-desc">创建定时任务来自动执行重复性工作。</div>
      </div>
      <div v-else class="automation-list">
        <div v-for="a in automations" :key="a.id" class="automation-card" :class="{ disabled: !a.enabled }">
          <div class="automation-header">
            <span class="automation-name">{{ a.name }}</span>
            <div class="automation-actions">
              <button class="btn-icon" :disabled="running.has(a.id)" @click="handleRun(a)">
                {{ running.has(a.id) ? '运行中…' : '立即运行' }}
              </button>
              <button class="btn-icon" @click="toggleHistory(a)">历史</button>
              <button class="btn-icon" @click="handleToggle(a)">{{ a.enabled ? '暂停' : '启用' }}</button>
              <button class="btn-icon btn-danger" @click="handleDelete(a.id)">删除</button>
            </div>
          </div>
          <div class="automation-meta">
            <span class="meta-item">📅 {{ scheduleLabel(a) }}</span>
            <span class="meta-item">⚡ {{ actionLabel(a) }}</span>
            <span v-if="a.run_count" class="meta-item">已执行 {{ a.run_count }} 次</span>
          </div>
          <div v-if="expandedHistory === a.id" class="history-panel">
            <div v-if="!historyMap[a.id]" class="history-empty">加载中...</div>
            <div v-else-if="historyMap[a.id].length === 0" class="history-empty">暂无执行记录</div>
            <div v-else class="history-list">
              <div v-for="run in historyMap[a.id]" :key="run.id" class="history-row">
                <span class="history-status" :class="run.status">{{ run.status }}</span>
                <span class="history-time">{{ run.started_at }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'
import { toErrorMessage } from '@/utils/error'
import { confirmAction } from '@/composables/useConfirm'
import { useViewEntrance } from '@/composables/useViewEntrance'

interface AutomationAction {
  type: string
  payload: Record<string, unknown>
}

interface Automation {
  id: string
  name: string
  description: string
  cron_expr: string | null
  interval_seconds: number | null
  action: AutomationAction
  enabled: boolean
  created_at: string
  last_run: string | null
  next_run: string | null
  run_count: number
}

interface RunHistoryEntry {
  id: number
  automation_id: string
  started_at: string
  finished_at: string
  status: string
  result: string | null
}

const loading = ref(true)
const error = ref('')
const automations = ref<Automation[]>([])
const form = ref({ name: '', schedule: '', action: '' })
const running = ref<Set<string>>(new Set())
const expandedHistory = ref<string | null>(null)
const historyMap = ref<Record<string, RunHistoryEntry[]>>({})

const rootEl = ref<HTMLElement | null>(null)
useViewEntrance(() => rootEl.value, { header: '.header', blocks: '.automation-card', ready: () => !loading.value })

const canCreate = computed(() =>
  Boolean(form.value.name.trim() && form.value.schedule.trim() && form.value.action.trim())
)

/** 后端 action 为结构化对象，展示其自由文本或类型。 */
function actionLabel(a: Automation): string {
  const text = a.action?.payload?.text
  if (typeof text === 'string' && text.trim()) return text
  return a.action?.type ?? '—'
}

/** 展示调度：优先 cron 表达式，否则按秒间隔。 */
function scheduleLabel(a: Automation): string {
  if (a.cron_expr) return a.cron_expr
  if (a.interval_seconds) return `每 ${a.interval_seconds} 秒`
  return '—'
}

onMounted(load)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await api.request<{ automations: Automation[] }>('/automations')
    automations.value = res.automations
  } catch (e) {
    error.value = toErrorMessage(e)
  } finally {
    loading.value = false
  }
}

async function handleCreate() {
  if (!canCreate.value) return
  try {
    // 后端契约：需 cron_expr（或 interval_seconds）+ 结构化 action 对象。
    // 表单的 schedule 映射为 cron_expr，自由文本 action 包装为 custom payload。
    const created = await api.request<Automation>('/automations', {
      method: 'POST',
      body: JSON.stringify({
        name: form.value.name.trim(),
        cron_expr: form.value.schedule.trim(),
        action: { type: 'custom', payload: { text: form.value.action.trim() } },
      }),
    })
    automations.value.push(created)
    form.value = { name: '', schedule: '', action: '' }
  } catch (e) {
    error.value = toErrorMessage(e)
  }
}

async function handleToggle(a: Automation) {
  try {
    // 使用专用 PATCH /toggle 端点：后端自动翻转 enabled 并重算 next_run。
    const updated = await api.request<Automation>(`/automations/${a.id}/toggle`, {
      method: 'PATCH',
    })
    const idx = automations.value.findIndex(x => x.id === a.id)
    if (idx !== -1) automations.value[idx] = updated
  } catch (e) {
    error.value = toErrorMessage(e)
  }
}

async function handleRun(a: Automation) {
  if (running.value.has(a.id)) return
  running.value = new Set(running.value).add(a.id)
  try {
    await api.request(`/automations/${a.id}/run`, { method: 'POST' })
    // 刷新以获取更新后的 run_count / last_run
    await load()
    // 若历史面板已展开，同步刷新
    if (expandedHistory.value === a.id) await loadHistory(a.id)
  } catch (e) {
    error.value = toErrorMessage(e)
  } finally {
    const next = new Set(running.value)
    next.delete(a.id)
    running.value = next
  }
}

async function loadHistory(id: string) {
  try {
    const res = await api.request<{ history: RunHistoryEntry[] }>(`/automations/${id}/history`)
    historyMap.value = { ...historyMap.value, [id]: res.history }
  } catch (e) {
    error.value = toErrorMessage(e)
  }
}

async function toggleHistory(a: Automation) {
  if (expandedHistory.value === a.id) {
    expandedHistory.value = null
    return
  }
  expandedHistory.value = a.id
  if (!historyMap.value[a.id]) await loadHistory(a.id)
}

async function handleDelete(id: string) {
  if (!await confirmAction({ title: '删除任务', message: '确定要删除此自动化任务吗？', confirmText: '删除', danger: true })) return
  try {
    await api.request(`/automations/${id}`, { method: 'DELETE' })
    automations.value = automations.value.filter(a => a.id !== id)
  } catch (e) {
    error.value = toErrorMessage(e)
  }
}
</script>

<style scoped>
.automation-view { max-width: 800px; margin: 0 auto; padding: 24px 16px 80px; }
.header { margin-bottom: 16px; }
.header h2 { font-size: var(--fs-display-lg); font-weight: 600; font-family: var(--font-display); letter-spacing: -0.01em; margin: 0; }
.header-sub { font-size: 0.82em; color: var(--text-tertiary); margin: 4px 0 0; }
.loading, .empty { text-align: center; padding: 40px; color: var(--text-tertiary); }
.empty-icon { font-size: 2em; margin-bottom: 8px; }
.empty-title { font-size: 1em; font-weight: 600; margin-bottom: 4px; }
.empty-desc { font-size: 0.85em; }
.error-banner { padding: 10px 12px; background: rgba(239,68,68,0.1); color: #ef4444; border-radius: 6px; font-size: 0.85em; margin-bottom: 12px; }

.section { margin-bottom: 20px; }
.create-section { padding: 14px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); }
.create-row { display: flex; gap: 8px; flex-wrap: wrap; }
.form-input {
  flex: 1; min-width: 120px; padding: 8px 12px; border: 1px solid var(--border);
  border-radius: 6px; background: var(--bg-secondary); color: var(--text-primary); font-size: 0.85em;
}
.form-input:focus { outline: none; border-color: var(--accent); }
.flex-2 { flex: 2; }

.btn { padding: 8px 16px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-secondary); cursor: pointer; font-size: 0.85em; color: var(--text-secondary); white-space: nowrap; }
.btn-primary { background: var(--accent); color: white; border-color: var(--accent); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.automation-list { display: flex; flex-direction: column; gap: 8px; }
.automation-card {
  padding: 14px; background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius);
}
.automation-card.disabled { opacity: 0.6; }
.automation-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.automation-name { font-weight: 600; font-size: 0.95em; color: var(--text-primary); }
.automation-actions { display: flex; gap: 6px; }
.btn-icon {
  padding: 4px 10px; border: 1px solid var(--border); border-radius: 4px;
  background: var(--bg-secondary); cursor: pointer; font-size: 0.78em; transition: all 0.15s;
}
.btn-icon:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-danger { color: #ef4444; border-color: rgba(239,68,68,0.3); }
.btn-danger:hover { background: rgba(239,68,68,0.1); }
.automation-meta { display: flex; gap: 16px; flex-wrap: wrap; }
.meta-item { font-size: 0.8em; color: var(--text-tertiary); }
.history-panel { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
.history-empty { font-size: 0.8em; color: var(--text-tertiary); padding: 4px 0; }
.history-list { display: flex; flex-direction: column; gap: 4px; }
.history-row { display: flex; gap: 12px; align-items: center; font-size: 0.78em; }
.history-status {
  padding: 1px 8px; border-radius: 4px; text-transform: uppercase; font-size: 0.85em;
  background: var(--bg-secondary); color: var(--text-secondary);
}
.history-status.completed { background: rgba(34,197,94,0.15); color: #22c55e; }
.history-status.failed { background: rgba(239,68,68,0.15); color: #ef4444; }
.history-time { color: var(--text-tertiary); }
</style>
