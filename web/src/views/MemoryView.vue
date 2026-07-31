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

    <!-- Hindsight 配置 -->
    <div class="hindsight-section" v-if="!store.loading">
      <div class="hindsight-header" @click="hindsightOpen = !hindsightOpen">
        <span class="hindsight-title">Hindsight 配置</span>
        <span class="hindsight-hint">{{ hindsight.enabled ? '已启用' : '已停用' }}</span>
        <span class="hindsight-caret">{{ hindsightOpen ? '▾' : '▸' }}</span>
      </div>
      <div v-if="hindsightOpen" class="hindsight-body">
        <div class="hs-row">
          <div class="hs-info">
            <div class="hs-label">启用 Hindsight 记忆处理</div>
            <div class="hs-desc">对历史对话进行回顾，提炼并巩固长期记忆。</div>
          </div>
          <button class="hs-toggle" :class="{ on: hindsight.enabled }" @click="setHindsight('enabled', !hindsight.enabled)">
            {{ hindsight.enabled ? '开启' : '关闭' }}
          </button>
        </div>

        <div class="hs-row">
          <div class="hs-info">
            <div class="hs-label">保留天数</div>
            <div class="hs-desc">参与回顾处理的对话时间窗口。</div>
          </div>
          <div class="hs-control">
            <input type="range" min="7" max="365" step="1"
              :value="hindsight.retention_days"
              @input="setHindsight('retention_days', Number(($event.target as HTMLInputElement).value))" />
            <span class="hs-value">{{ hindsight.retention_days }}天</span>
          </div>
        </div>

        <div class="hs-row">
          <div class="hs-info">
            <div class="hs-label">重要性阈值</div>
            <div class="hs-desc">仅固化重要度达到此阈值的记忆。</div>
          </div>
          <div class="hs-control">
            <input type="range" min="0.1" max="1.0" step="0.05"
              :value="hindsight.importance_threshold"
              @input="setHindsight('importance_threshold', Number(($event.target as HTMLInputElement).value))" />
            <span class="hs-value">{{ hindsight.importance_threshold.toFixed(2) }}</span>
          </div>
        </div>

        <div class="hs-row">
          <div class="hs-info">
            <div class="hs-label">处理模式</div>
            <div class="hs-desc">选择 Hindsight 的触发方式。</div>
          </div>
          <select class="hs-select" :value="hindsight.processing_mode"
            @change="setHindsight('processing_mode', ($event.target as HTMLSelectElement).value as HindsightConfig['processing_mode'])">
            <option value="auto">自动</option>
            <option value="manual">手动</option>
            <option value="scheduled">定时</option>
          </select>
        </div>

        <div class="hs-row hs-row-block">
          <div class="hs-info">
            <div class="hs-label">自定义提示词模板</div>
            <div class="hs-desc">留空则使用内置模板。</div>
          </div>
          <textarea class="hs-textarea" rows="4" :value="hindsight.prompt_template"
            placeholder="回顾以下对话，提取值得长期保留的事实……"
            @change="setHindsight('prompt_template', ($event.target as HTMLTextAreaElement).value)" />
        </div>
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
      <div v-else ref="factListEl" class="fact-list">
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
import { ref, computed, onMounted, watch } from 'vue'
import { useMemoryStore, type MemoryFact } from '@/stores/memory'
import { api } from '@/api'
import type { HindsightConfig } from '@/api'
import { confirmAction } from '@/composables/useConfirm'
import { createLogger } from '@/utils/logger'
import { gsap, useGsap, easeMap } from '@/composables/useGsap'

const log = createLogger('MemoryView')

const store = useMemoryStore()

const searchQuery = ref('')
const factListEl = ref<HTMLElement | null>(null)

// 记忆列表错落入场：仅在加载完成/进入视图时播放一次，搜索筛选不重播（避免打扰）
const { contextSafe } = useGsap(() => {
  watch(() => store.loading, contextSafe((l) => {
    if (l || !factListEl.value) return
    const cards = gsap.utils.toArray<HTMLElement>('.fact-card', factListEl.value)
    if (!cards.length) return
    gsap.from(cards, { opacity: 0, y: 12, duration: 0.3, ease: easeMap.out, stagger: 0.05 })
  }), { immediate: true })
}, { scope: () => factListEl.value })
const categoryFilter = ref('all')
const confidenceFilter = ref('0')
const editingId = ref<string | null>(null)
const editContent = ref('')
const editCategory = ref('preference')
const stats = ref<{ total: number; categories: Record<string, number>; avg_confidence: number }>({
  total: 0, categories: {}, avg_confidence: 0,
})

// ── Hindsight 配置 ──
const hindsightOpen = ref(false)
const hindsight = ref<HindsightConfig>({
  enabled: false,
  retention_days: 90,
  importance_threshold: 0.5,
  processing_mode: 'auto',
  prompt_template: '',
})

async function loadHindsightConfig() {
  try {
    hindsight.value = { ...hindsight.value, ...(await api.getHindsightConfig()) }
  } catch (e) {
    log.warn('[memory] load hindsight config failed:', e)
  }
}

async function setHindsight<K extends keyof HindsightConfig>(key: K, value: HindsightConfig[K]) {
  const prev = hindsight.value[key]
  hindsight.value[key] = value
  try {
    hindsight.value = { ...hindsight.value, ...(await api.updateHindsightConfig({ [key]: value })) }
  } catch (e) {
    log.warn(`[memory] set hindsight.${String(key)} failed:`, e)
    hindsight.value[key] = prev
  }
}

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
  await Promise.all([loadFacts(), loadHindsightConfig()])
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

/* Hindsight 配置 */
.hindsight-section {
  margin-bottom: 16px; border: 1px solid var(--border);
  border-radius: var(--radius); background: var(--bg-card); overflow: hidden;
}
.hindsight-header {
  display: flex; align-items: center; gap: 8px; padding: 10px 14px;
  cursor: pointer; user-select: none;
}
.hindsight-title { font-size: 0.9em; font-weight: 600; }
.hindsight-hint { font-size: 0.72em; color: var(--text-tertiary); }
.hindsight-caret { margin-left: auto; font-size: 0.8em; color: var(--text-tertiary); }
.hindsight-body { padding: 4px 14px 12px; border-top: 1px solid var(--border); }
.hs-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; padding: 10px 0; border-bottom: 1px solid var(--border);
}
.hs-row:last-child { border-bottom: none; }
.hs-row-block { flex-direction: column; align-items: stretch; gap: 8px; }
.hs-info { flex: 1; min-width: 0; }
.hs-label { font-size: 0.85em; font-weight: 500; }
.hs-desc { font-size: 0.72em; color: var(--text-tertiary); margin-top: 2px; }
.hs-control { display: flex; align-items: center; gap: 8px; }
.hs-control input[type="range"] { width: 120px; }
.hs-value { font-size: 0.78em; color: var(--text-secondary); min-width: 44px; text-align: right; }
.hs-toggle {
  padding: 4px 12px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg-secondary); color: var(--text-secondary); font-size: 0.78em;
  cursor: pointer; transition: all 0.15s; white-space: nowrap;
}
.hs-toggle.on { background: var(--accent); color: white; border-color: var(--accent); }
.hs-select {
  padding: 4px 8px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg-secondary); color: var(--text-primary); font-size: 0.78em; cursor: pointer;
}
.hs-textarea {
  width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg-secondary); color: var(--text-primary); font-size: 0.82em;
  font-family: inherit; line-height: 1.6; resize: vertical; box-sizing: border-box;
}
</style>
