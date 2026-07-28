<template>
  <div class="memory-view">
    <div class="header">
      <h2>记忆 Memory</h2>
      <p class="header-sub">AI 自动记录的长期事实——偏好、背景、历史决策。</p>
    </div>

    <!-- 统计栏 -->
    <div class="stats-row" v-if="!store.loading">
      <div class="stat-card"><div class="stat-value">{{ stats.total ?? facts.length }}</div><div class="stat-label">总条数</div></div>
      <div class="stat-card"><div class="stat-value">{{ stats.avg_confidence ?? '-' }}</div><div class="stat-label">平均置信度</div></div>
      <div class="stat-card" v-for="(count, cat) in stats.categories ?? {}" :key="cat">
        <div class="stat-value">{{ count }}</div>
        <div class="stat-label">{{ categoryLabel(cat) }}</div>
      </div>
    </div>

    <!-- 搜索 + 过滤 -->
    <div class="toolbar">
      <div class="search-box">
        <input v-model="searchQuery" type="text" placeholder="搜索记忆内容..." @input="debouncedSearch" />
      </div>
      <select v-model="categoryFilter" class="filter-select" @change="loadFacts">
        <option value="all">全部分类</option>
        <option v-for="cat in categoryOptions" :key="cat" :value="cat">{{ categoryLabel(cat) }}</option>
      </select>
      <select v-model="confidenceFilter" class="filter-select" @change="loadFacts">
        <option value="0">全部置信度</option>
        <option value="0.5">50% 以上</option>
        <option value="0.8">80% 以上</option>
      </select>
    </div>

    <div v-if="store.loading" class="loading">加载中...</div>
    <template v-else>
      <div v-if="facts.length === 0" class="empty">
        <div class="empty-icon">🧠</div>
        <div class="empty-title">{{ searchQuery ? '未匹配到记忆' : '暂无记忆数据' }}</div>
        <div class="empty-desc">
          <template v-if="!searchQuery">与 AI 对话后，OMP 会自动记录有价值的事实。</template>
          <template v-else>尝试其他搜索词或清除筛选条件。</template>
          <router-link to="/" class="empty-link">→ 返回对话</router-link>
        </div>
      </div>
      <div v-else class="fact-list">
        <div v-for="fact in facts" :key="fact.id" class="fact-card">
          <div v-if="editingId === fact.id" class="fact-edit">
            <textarea v-model="editContent" class="edit-textarea" rows="3" />
            <div class="edit-actions">
              <select v-model="editCategory" class="filter-select">
                <option value="preference">偏好</option>
                <option value="event">事件</option>
                <option value="knowledge">知识</option>
                <option value="rule">规则</option>
                <option value="other">其他</option>
              </select>
              <button class="btn btn-primary" @click="saveEdit(fact.id)">保存</button>
              <button class="btn" @click="cancelEdit">取消</button>
            </div>
          </div>
          <template v-else>
            <div class="fact-content" @dblclick="startEdit(fact)">{{ fact.content }}</div>
            <div class="fact-meta">
              <span class="fact-cat">{{ categoryLabel(fact.category) }}</span>
              <span class="fact-confidence" :class="`conf-${confidenceLevel(fact.confidence)}`">
                {{ (fact.confidence * 100).toFixed(0) }}% 把握
              </span>
              <span class="fact-time">{{ formatTime(fact.updatedAt) }}</span>
              <button class="fact-action" @click="startEdit(fact)" title="编辑">✎</button>
              <button class="fact-delete" @click="handleDelete(fact.id)" title="删除">✕</button>
            </div>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useMemoryStore, type MemoryFact } from '@/stores/memory'
import { api } from '@/api'
import { confirmAction } from '@/composables/useConfirm'
import { createLogger } from '@/utils/logger'

const log = createLogger('MemoryView')

const store = useMemoryStore()

const searchQuery = ref('')
const categoryFilter = ref('all')
const confidenceFilter = ref('0')
const editingId = ref<string | null>(null)
const editContent = ref('')
const editCategory = ref('preference')
const stats = ref<{ total: number; categories: Record<string, number>; avg_confidence: number }>({
  total: 0, categories: {}, avg_confidence: 0,
})

const categoryOptions = ['preference', 'event', 'knowledge', 'rule', 'other']

function categoryLabel(cat: string): string {
  const labels: Record<string, string> = { preference: '偏好', event: '事件', knowledge: '知识', rule: '规则', other: '其他' }
  return labels[cat] ?? cat
}

function confidenceLevel(c: number): string {
  if (c >= 0.8) return 'high'
  if (c >= 0.5) return 'mid'
  return 'low'
}

function formatTime(t: string): string {
  if (!t) return ''
  try { return new Date(t).toLocaleDateString('zh-CN') } catch { return t }
}

const facts = computed(() => store.facts)

let debounceTimer: ReturnType<typeof setTimeout> | null = null
function debouncedSearch() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(loadFacts, 300)
}

async function loadFacts() {
  try {
    const q = searchQuery.value.trim()
    const cat = categoryFilter.value !== 'all' ? categoryFilter.value : undefined
    const mc = confidenceFilter.value !== '0' ? parseFloat(confidenceFilter.value) : undefined
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (cat) params.set('category', cat)
    if (mc) params.set('min_confidence', String(mc))
    const qs = params.toString()
    const data = await api.request<MemoryFact[]>(`/memory${qs ? '?' + qs : ''}`)
    store.facts = Array.isArray(data) ? data : []
  } catch { store.facts = [] }

  // Load stats
  try {
    stats.value = await api.request<{ total: number; categories: Record<string, number>; avg_confidence: number }>('/memory/stats')
  } catch { /* ignore */ }
}

function startEdit(fact: MemoryFact) {
  editingId.value = fact.id
  editContent.value = fact.content
  editCategory.value = fact.category
}

function cancelEdit() {
  editingId.value = null
  editContent.value = ''
  editCategory.value = 'preference'
}

async function saveEdit(id: string) {
  try {
    await api.request(`/memory/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ content: editContent.value, category: editCategory.value }),
    })
    editingId.value = null
    await loadFacts()
  } catch (e) {
    log.warn('[memory] saveEdit failed:', e)
  }
}

async function handleDelete(id: string) {
  if (!await confirmAction({
    title: '删除记忆',
    message: '确定删除此记忆？',
    confirmText: '删除',
    danger: true,
  })) return
  try {
    await api.request(`/memory/${encodeURIComponent(id)}`, { method: 'DELETE' })
    await loadFacts()
  } catch (e) {
    log.warn('[memory] delete failed:', e)
  }
}

onMounted(async () => {
  store.loading = true
  await loadFacts()
  store.loading = false
})
</script>

<style scoped>
.memory-view {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}
.header { margin-bottom: 16px; }
.header h2 { font-size: var(--fs-display-lg); font-weight: 600; font-family: var(--font-display); letter-spacing: -0.01em; margin: 0; }
.header-sub { font-size: 0.82em; color: var(--text-tertiary); margin: 4px 0 0; }

/* Stats bar */
.stats-row { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.stat-card {
  flex: 1; min-width: 80px; text-align: center;
  padding: 10px 8px; background: var(--bg-secondary); border-radius: var(--radius);
  border: 1px solid var(--border);
}
.stat-value { font-size: 1.4em; font-weight: 700; color: var(--accent); }
.stat-label { font-size: 0.7em; color: var(--text-tertiary); margin-top: 2px; }

/* Toolbar */
.toolbar {
  display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap;
}
.search-box { flex: 1; min-width: 160px; }
.search-box input {
  width: 100%; padding: 8px 12px; border: 1px solid var(--border);
  border-radius: 6px; background: var(--bg-secondary); color: var(--text-primary);
  font-size: 0.85em; box-sizing: border-box;
}
.filter-select {
  padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg-secondary); color: var(--text-primary); font-size: 0.8em;
}

.loading, .empty { text-align: center; padding: 40px; color: var(--text-tertiary); }
.empty-icon { font-size: 2em; margin-bottom: 8px; }
.empty-title { font-size: 1em; font-weight: 600; margin-bottom: 4px; }
.empty-desc { font-size: 0.85em; line-height: 1.6; }
.empty-link { color: var(--accent); text-decoration: none; display: inline-block; margin-top: 8px; }

.fact-list { display: flex; flex-direction: column; gap: 8px; max-height: 600px; overflow-y: auto; }
.fact-card {
  padding: 12px 14px; background: var(--bg-card); border: 1px solid var(--border);
  border-radius: var(--radius); transition: border-color 0.15s;
  overflow: hidden;
}
.fact-card:hover { border-color: var(--accent-soft, var(--border)); }
.fact-content { font-size: 0.9em; line-height: 1.6; color: var(--text-primary); word-break: break-word; cursor: pointer; }
.fact-content:hover { color: var(--accent); }
.fact-meta { display: flex; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
.fact-cat { font-size: 0.72em; padding: 2px 8px; border-radius: 4px; background: var(--bg-secondary); color: var(--text-tertiary); }
.fact-confidence { font-size: 0.72em; padding: 2px 6px; border-radius: 4px; }
.fact-confidence.conf-high { color: #22c55e; background: rgba(34,197,94,0.08); }
.fact-confidence.conf-mid { color: #f59e0b; background: rgba(245,158,11,0.08); }
.fact-confidence.conf-low { color: var(--text-tertiary); background: var(--bg-secondary); }
.fact-time { font-size: 0.72em; color: var(--text-tertiary); margin-left: auto; }
.fact-action, .fact-delete {
  background: none; border: none; cursor: pointer; font-size: 0.85em;
  padding: 2px 6px; border-radius: 4px; color: var(--text-tertiary); transition: color 0.1s;
}
.fact-action:hover { color: var(--accent); background: var(--bg-secondary); }
.fact-delete:hover { color: #ef4444; background: rgba(239,68,68,0.08); }

/* Edit mode */
.fact-edit { display: flex; flex-direction: column; gap: 8px; }
.edit-textarea {
  width: 100%; padding: 8px; border: 1px solid var(--accent); border-radius: 6px;
  background: var(--bg-secondary); color: var(--text-primary); font-size: 0.9em;
  font-family: inherit; line-height: 1.6; resize: vertical; box-sizing: border-box;
}
.edit-actions { display: flex; gap: 8px; align-items: center; }
.btn {
  padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg-secondary); color: var(--text-secondary); cursor: pointer; font-size: 0.8em;
}
.btn-primary { background: var(--accent); color: white; border-color: var(--accent); }
</style>
