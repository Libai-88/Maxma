<template>
  <div class="metrics-view">
    <div class="header">
      <h2>运行时指标 Metrics</h2>
      <div class="header-actions">
        <span v-if="loading" class="badge-muted">刷新中…</span>
        <span v-else-if="error" class="badge-error" :title="error">获取失败</span>
        <span v-else-if="snapshot" class="badge-muted">运行 {{ formatUptime(snapshot.uptime_seconds) }}</span>
        <button class="btn-small" @click="refresh">刷新</button>
        <label class="auto-toggle">
          <input type="checkbox" v-model="autoRefresh" /> 自动刷新 (15s)
        </label>
      </div>
    </div>

    <details class="metrics-guide" open>
      <summary>这些指标是什么？我该关注什么？</summary>
      <div class="guide-body">
        <p>本页展示 Maxma 后端进程的实时运行数据，帮助判断应用是否健康、AI 是否按预期工作。普通用户只需要关注下面几点：</p>
        <ul>
          <li><strong>HTTP 请求</strong>：前端与本地后端通信的请求数与延迟。延迟突然飙高说明后端响应变慢。</li>
          <li><strong>工具调用</strong>：AI 实际使用的工具次数（搜索、文件读写、MCP 等）。错误数 > 0 提示有工具失败。</li>
          <li><strong>LLM 调用</strong>：调用 AI 模型的次数与 Token 消耗——可据此估算 API 费用。</li>
          <li><strong>错误统计</strong>：按类别聚合的应用错误。健康状态下应为空或极少。</li>
          <li><strong>历史趋势</strong>：可切换 30 分钟 ~ 24 小时窗口，观察指标随时间的变化。</li>
        </ul>
        <p class="guide-note">想看"AI 在什么时候做了什么"？前往<router-link to="/privacy">隐私仪表盘</router-link>的审计日志区。</p>
      </div>
    </details>

    <div v-if="!snapshot && loading" class="loading-text">加载中…</div>
    <div v-else-if="!snapshot" class="empty-text">暂无数据</div>
    <template v-else>
      <!-- HTTP 区 -->
      <section class="card">
        <h3>HTTP 请求</h3>
        <p class="section-desc">前端发往本地后端的 HTTP 请求总量、延迟分布与状态码构成。延迟飙升或 5xx 占比高，通常意味着后端卡顿或异常。</p>
        <div class="stat-grid">
          <div class="stat">
            <div class="stat-value">{{ snapshot.http.total_requests }}</div>
            <div class="stat-label">总请求数</div>
          </div>
          <div class="stat">
            <div class="stat-value">{{ snapshot.http.latency_ms.count }}</div>
            <div class="stat-label">采样数</div>
          </div>
          <div class="stat">
            <div class="stat-value">{{ snapshot.http.latency_ms.avg_ms.toFixed(1) }}<span class="unit">ms</span></div>
            <div class="stat-label">平均延迟</div>
          </div>
          <div class="stat">
            <div class="stat-value">{{ snapshot.http.latency_ms.max_ms.toFixed(1) }}<span class="unit">ms</span></div>
            <div class="stat-label">最大延迟</div>
          </div>
        </div>
        <div class="sub-section">
          <div class="sub-title">状态码分布</div>
          <BarChartMini
            :items="statusCodeItems"
            :max-value="statusCodeMax"
            :height="80"
          />
        </div>
        <div class="sub-section">
          <div class="sub-title">Top 路径 (按请求数)</div>
          <BarChartMini
            :items="topPathItems"
            :height="160"
          />
        </div>
      </section>

      <!-- Tools 区 -->
      <section class="card">
        <h3>工具调用</h3>
        <p class="section-desc">AI 在对话中实际调用的工具（搜索 / 文件读写 / MCP / 内置能力等）的总次数、错误数与按工具的分布。</p>
        <div class="stat-grid">
          <div class="stat">
            <div class="stat-value">{{ snapshot.tools.total_calls }}</div>
            <div class="stat-label">总调用数</div>
          </div>
          <div class="stat">
            <div class="stat-value" :class="{ 'text-error': snapshot.tools.total_errors > 0 }">
              {{ snapshot.tools.total_errors }}
            </div>
            <div class="stat-label">错误总数</div>
          </div>
          <div class="stat">
            <div class="stat-value">{{ Object.keys(snapshot.tools.by_tool).length }}</div>
            <div class="stat-label">工具种类</div>
          </div>
        </div>
        <div class="sub-section">
          <div class="sub-title">工具调用排行</div>
          <BarChartMini
            :items="toolItems"
            :height="180"
          />
        </div>
      </section>

      <!-- LLM 区 -->
      <section class="card">
        <h3>LLM 调用</h3>
        <p class="section-desc">调用 AI 语言模型（如 DeepSeek、Ollama）的次数与 Token 消耗。输出 Token 越多，对话越长、API 费用越高。</p>
        <div class="stat-grid">
          <div class="stat">
            <div class="stat-value">{{ snapshot.llm.total_calls }}</div>
            <div class="stat-label">调用次数</div>
          </div>
          <div class="stat">
            <div class="stat-value">{{ formatTokens(snapshot.llm.total_tokens_in) }}</div>
            <div class="stat-label">输入 Tokens</div>
          </div>
          <div class="stat">
            <div class="stat-value">{{ formatTokens(snapshot.llm.total_tokens_out) }}</div>
            <div class="stat-label">输出 Tokens</div>
          </div>
          <div class="stat">
            <div class="stat-value">{{ snapshot.llm.latency_ms.avg_ms.toFixed(1) }}<span class="unit">ms</span></div>
            <div class="stat-label">平均延迟</div>
          </div>
        </div>
        <div v-if="Object.keys(snapshot.llm.by_model).length > 0" class="sub-section">
          <div class="sub-title">按模型分布</div>
          <BarChartMini
            :items="modelItems"
            :height="100"
          />
        </div>
      </section>

      <!-- Errors 区 -->
      <section class="card">
        <h3>错误统计</h3>
        <p class="section-desc">按类别聚合的应用级错误。健康状态下应该为空或数量极少；某类别突增说明对应子系统可能异常。</p>
        <div v-if="Object.keys(snapshot.errors).length === 0" class="empty-text">暂无错误</div>
        <template v-else>
          <div class="stat-grid">
            <div class="stat" v-for="(count, category) in snapshot.errors" :key="category">
              <div class="stat-value text-error">{{ count }}</div>
              <div class="stat-label">{{ category }}</div>
            </div>
          </div>
        </template>
      </section>

      <!-- 历史趋势 -->
      <section class="card">
        <h3>历史趋势</h3>
        <p class="section-desc">按时间窗口采样的历史指标，用于观察趋势（例如请求量高峰、错误突增、Token 消耗累积）。</p>
        <div class="history-controls">
          <select v-model="historyWindow" @change="loadHistory">
            <option :value="1800">最近 30 分钟</option>
            <option :value="3600">最近 1 小时</option>
            <option :value="21600">最近 6 小时</option>
            <option :value="86400">最近 24 小时</option>
          </select>
          <button class="btn-small" @click="loadHistory">刷新</button>
        </div>
        <div v-if="!history || history.snapshots.length < 2" class="empty-text">暂无足够的历史快照</div>
        <template v-else>
          <div class="sub-section">
            <div class="sub-title">HTTP 请求数 ({{ history.snapshots.length }} 个采样点)</div>
            <Sparkline :data="httpHistorySeries" :width="600" :height="60" />
          </div>
          <div class="sub-section">
            <div class="sub-title">工具调用数</div>
            <Sparkline :data="toolHistorySeries" :width="600" :height="60" />
          </div>
          <div class="sub-section">
            <div class="sub-title">LLM Tokens (输出)</div>
            <Sparkline :data="llmHistorySeries" :width="600" :height="60" />
          </div>
        </template>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useMetricsStore } from '@/stores/metrics'
import Sparkline from '@/components/Sparkline.vue'
import BarChartMini from '@/components/BarChartMini.vue'

const metricsStore = useMetricsStore()
const { snapshot, history, loading, error } = storeToRefs(metricsStore)

const autoRefresh = ref(true)
const historyWindow = ref(3600)
let _timer: ReturnType<typeof setInterval> | null = null

async function refresh() {
  await metricsStore.refresh()
}

async function loadHistory() {
  await metricsStore.loadHistory(historyWindow.value)
}

function startTimer() {
  stopTimer()
  _timer = setInterval(() => {
    if (autoRefresh.value) refresh()
  }, 15000)
}

function stopTimer() {
  if (_timer !== null) {
    clearInterval(_timer)
    _timer = null
  }
}

watch(autoRefresh, (val) => {
  if (val) startTimer()
  else stopTimer()
})

onMounted(() => {
  refresh()
  loadHistory()
  startTimer()
})

onUnmounted(() => {
  stopTimer()
})

// ── 派生数据 ──

const statusCodeItems = computed(() => {
  if (!snapshot.value) return []
  return Object.entries(snapshot.value.http.status_codes).map(([code, count]) => ({
    label: code,
    value: count,
    kind: code.startsWith('5') ? 'error' as const : 'default' as const,
  }))
})

const statusCodeMax = computed(() =>
  statusCodeItems.value.length > 0 ? Math.max(...statusCodeItems.value.map(i => i.value)) : 1,
)

const topPathItems = computed(() => {
  if (!snapshot.value) return []
  return Object.entries(snapshot.value.http.top_paths).map(([path, hist]) => ({
    label: path,
    value: hist.count,
    display: `${hist.count} / ${hist.avg_ms.toFixed(0)}ms`,
  }))
})

const toolItems = computed(() => {
  if (!snapshot.value) return []
  return Object.entries(snapshot.value.tools.by_tool).map(([name, info]) => ({
    label: name,
    value: info.count,
    display: info.errors ? `${info.count} (err ${info.errors})` : String(info.count),
    kind: (info.errors && info.errors > 0) ? 'error' as const : 'default' as const,
  }))
})

const modelItems = computed(() => {
  if (!snapshot.value) return []
  return Object.entries(snapshot.value.llm.by_model).map(([model, count]) => ({
    label: model,
    value: count,
  }))
})

const httpHistorySeries = computed(() => {
  if (!history.value) return []
  return history.value.snapshots.map(s => s.http?.total_requests ?? 0)
})

const toolHistorySeries = computed(() => {
  if (!history.value) return []
  return history.value.snapshots.map(s => s.tools?.total_calls ?? 0)
})

const llmHistorySeries = computed(() => {
  if (!history.value) return []
  return history.value.snapshots.map(s => s.llm?.total_tokens_out ?? 0)
})

// ── 工具函数 ──

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1000000) return `${(n / 1000).toFixed(1)}K`
  return `${(n / 1000000).toFixed(2)}M`
}
</script>

<style scoped>
.metrics-view {
  flex: 1;
  padding: 24px 32px;
  max-width: 1100px;
  margin: 0 auto;
  overflow-y: auto;
  width: 100%;
  box-sizing: border-box;
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

/* ── 引导卡片 ── */
	.metrics-guide {
	  margin-bottom: 16px;
	  padding: 0;
	  border: 1px solid var(--border);
	  border-radius: 10px;
	  background: color-mix(in srgb, var(--accent) 5%, var(--bg-card));
	  border-color: color-mix(in srgb, var(--accent) 25%, var(--border));
	}
.metrics-guide > summary {
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
  list-style: none;
}
.metrics-guide > summary::-webkit-details-marker { display: none; }
.metrics-guide > summary::before {
  content: '▸';
  display: inline-block;
  margin-right: 8px;
  color: var(--text-tertiary);
  transition: transform 0.15s;
}
.metrics-guide[open] > summary::before { transform: rotate(90deg); }
.guide-body {
  padding: 0 16px 12px;
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.75;
}
.guide-body p { margin: 6px 0; }
.guide-body ul { margin: 6px 0; padding-left: 22px; }
.guide-body li { margin-bottom: 3px; }
.guide-body strong { color: var(--text-primary); }
.guide-note {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.section-desc {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0 0 12px;
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
  background: transparent;
  background: transparent;
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
.auto-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  cursor: pointer;
}
.auto-toggle input { cursor: pointer; }

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
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.stat {
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-primary);
}
.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}
.stat-value .unit {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-left: 2px;
}
.stat-value.text-error { color: var(--status-error); }
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

.history-controls {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  align-items: center;
}
.history-controls select {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
}

.loading-text, .empty-text {
  color: var(--text-secondary);
  font-size: 13px;
  padding: 16px 0;
  text-align: center;
}
</style>
