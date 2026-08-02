<template>
  <div class="capabilities-view">
    <div class="header">
      <h2>能力仪表盘 CAPABILITIES</h2>
      <p class="header-sub">OMP 自动发现与配置的全部能力模块概览</p>
    </div>

    <div v-if="loading" class="loading"><TextGenerateEffect words="加载中..." /></div>

    <div v-else-if="error" class="empty">
      <p>加载失败: {{ error }}</p>
      <button class="btn" @click="load">重试</button>
    </div>

    <template v-else>
      <!-- 系统概览卡片 -->
      <div class="section">
        <h3>系统概览</h3>
        <div ref="statsEl" class="stats-row">
          <GlareCard>
            <div class="stat-card">
              <div class="stat-value"><NumberTicker :value="Number(system.session_count) || 0" /></div>
              <div class="stat-label">活跃会话</div>
            </div>
          </GlareCard>
          <GlareCard>
            <div class="stat-card">
              <div class="stat-value"><NumberTicker :value="tools.length" /></div>
              <div class="stat-label">可用工具</div>
            </div>
          </GlareCard>
          <GlareCard>
            <div class="stat-card">
              <div class="stat-value"><NumberTicker :value="providers.length" /></div>
              <div class="stat-label">模型提供商</div>
            </div>
          </GlareCard>
          <GlareCard>
            <div class="stat-card">
              <div class="stat-value"><NumberTicker :value="mcp_servers.length + (discovered_mcp?.length ?? 0)" /></div>
              <div class="stat-label">MCP 服务器</div>
            </div>
          </GlareCard>
          <GlareCard>
            <div class="stat-card">
              <div class="stat-value"><NumberTicker :value="memory?.total ?? 0" /></div>
              <div class="stat-label">记忆条数</div>
            </div>
          </GlareCard>
          <GlareCard>
            <div class="stat-card">
              <div class="stat-value"><NumberTicker :value="plugins?.length ?? 0" /></div>
              <div class="stat-label">已装插件</div>
            </div>
          </GlareCard>
        </div>
        <div class="env-info" v-if="env.cwd">
          <div class="env-row"><span class="env-key">工作目录</span><span class="env-val">{{ env.cwd }}</span></div>
          <div class="env-row"><span class="env-key">平台</span><span class="env-val">{{ env.platform }}</span></div>
        </div>
      </div>

      <!-- Settings 概览 -->
      <div class="section">
        <h3>运行时配置</h3>
        <div v-if="Object.keys(settings).length === 0" class="empty">暂无可用的配置项</div>
        <BentoGrid :cols="2">
          <div v-for="(value, key) in settings" :key="key" class="config-item">
            <span class="config-key">{{ key }}</span>
            <span class="config-val">{{ formatValue(value) }}</span>
          </div>
        </BentoGrid>
      </div>

      <!-- 工具类别 -->
      <div class="section" v-if="Object.keys(tool_categories).length > 0">
        <h3>工具清单 ({{ tools.length }})</h3>
        <div v-for="(catTools, cat) in tool_categories" :key="cat" class="cat-section">
          <h4 class="cat-title">{{ categoryLabel(cat) }} ({{ catTools.length }})</h4>
          <div class="tool-grid">
            <DirectionAwareHover image-url="">
              <div v-for="t in catTools" :key="t.name" class="tool-chip" :title="t.description">
                <span class="tool-name">{{ t.label ?? t.name }}</span>
              </div>
            </DirectionAwareHover>
          </div>
        </div>
      </div>

      <!-- Provider 列表 -->
      <div class="section" v-if="providers.length > 0">
        <h3>模型提供商 ({{ providers.length }})</h3>
        <div class="provider-list">
          <div v-for="p in providers" :key="p.id" class="provider-row">
            <span class="provider-name">{{ p.name ?? p.id }}</span>
            <span class="provider-model">{{ p.model }}</span>
            <span class="provider-type">{{ p.provider }}</span>
            <span class="provider-status" :class="{ active: p.enabled }">{{ p.enabled ? '启用' : '禁用' }}</span>
          </div>
        </div>
      </div>

      <!-- MCP 服务器 -->
      <div class="section" v-if="mcp_servers.length > 0 || (discovered_mcp?.length ?? 0) > 0">
        <h3>MCP 服务器</h3>
        <div v-if="mcp_servers.length > 0">
          <h4 class="cat-title">已配置</h4>
          <div class="mcp-list">
            <div v-for="s in mcp_servers" :key="s.server_id" class="mcp-row">
              <span class="mcp-name">{{ s.name ?? s.server_id }}</span>
              <span class="mcp-transport">{{ s.transport ?? 'stdio' }}</span>
              <span class="mcp-status" :class="{ enabled: s.enabled !== false }">
                {{ s.enabled !== false ? '启用' : '禁用' }}
              </span>
            </div>
          </div>
        </div>
        <div v-if="discovered_mcp && discovered_mcp.length > 0">
          <h4 class="cat-title">自动发现</h4>
          <div class="mcp-list">
            <div v-for="s in discovered_mcp" :key="s.name" class="mcp-row">
              <span class="mcp-name">{{ s.name }}</span>
              <span class="mcp-transport">{{ s.transport }}</span>
              <span class="mcp-status connected">{{ s.status }}</span>
            </div>
          </div>
        </div>
      </div>
      <!-- 配置来源 -->
      <div class="section" v-if="configSources">
        <h3>配置来源 ({{ configSources.active_count }}/{{ configSources.total_count }} 活跃)</h3>
        <p class="section-desc">按优先级从高到低排列，高优先级覆盖低优先级。</p>
        <div class="source-list">
          <div v-for="s in configSources.sources" :key="s.name"
            class="source-row" :class="{ active: s.exists, inactive: !s.exists }">
            <span class="source-priority">#{{ s.priority }}</span>
            <div class="source-info">
              <span class="source-name">{{ s.name }}</span>
              <span class="source-desc">{{ s.description }}</span>
            </div>
            <span class="source-scope">{{ s.scope }}</span>
            <span class="source-status" :class="{ found: s.exists }">
              {{ s.exists ? '存在' : '未发现' }}
            </span>
          </div>
        </div>
        <div v-if="configSources.conflicts && configSources.conflicts.length" class="conflict-section">
          <h4 class="cat-title conflict-title">⚠️ 配置冲突</h4>
          <div v-for="c in configSources.conflicts" :key="c.scope" class="conflict-card">
            <div class="conflict-scope">{{ c.scope }}</div>
            <div class="conflict-sources">{{ c.sources.join(' ↔ ') }}</div>
            <div class="conflict-note">{{ c.note }}</div>
          </div>
        </div>
        <div v-else-if="configSources.active_count > 1" class="conflict-section">
          <div class="conflict-clear">✓ 未检测到配置冲突</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { api } from '@/api'
import type { ToolItem, ProviderItem } from '@/types'
import { gsap, useGsap, easeMap } from '@/composables/useGsap'
import GlareCard from '@/components/inspira/GlareCard.vue'
import DirectionAwareHover from '@/components/inspira/DirectionAwareHover.vue'
import BentoGrid from '@/components/inspira/BentoGrid.vue'
import NumberTicker from '@/components/inspira/NumberTicker.vue'
import TextGenerateEffect from '@/components/inspira/TextGenerateEffect.vue'

const loading = ref(true)
const error = ref('')
const settings = ref<Record<string, unknown>>({})
const tools = ref<ToolItem[]>([])
const tool_categories = ref<Record<string, ToolItem[]>>({})
const providers = ref<ProviderItem[]>([])

interface McpServerItem {
  server_id?: string
  name?: string
  transport?: string
  enabled?: boolean
  status?: string
  [key: string]: unknown
}

const mcp_servers = ref<McpServerItem[]>([])
const discovered_mcp = ref<McpServerItem[] | null>(null)
const env = ref<Record<string, string>>({})
const system = ref<Record<string, number | boolean>>({})
const memory = ref<{ total: number; categories: Record<string, number>; avg_confidence: number } | null>(null)
const plugins = ref<Record<string, unknown>[]>([])
const configSources = ref<{
  sources: Array<{ name: string; path: string; priority: number; exists: boolean; scope: string; description: string }>
  active_count: number; total_count: number
  conflicts: Array<{ scope: string; sources: string[]; severity: string; note: string }>
  resolution_order: string[]
} | null>(null)
const statsEl = ref<HTMLElement | null>(null)

// 数据加载完成后：统计卡片错落入场 + 数字 0→N 滚动
const { contextSafe } = useGsap(() => {
  watch(() => loading.value, contextSafe((l) => {
    if (l || !statsEl.value) return
    const cards = gsap.utils.toArray<HTMLElement>('.stat-card', statsEl.value)
    gsap.from(cards, { opacity: 0, y: 16, duration: 0.4, ease: easeMap.out, stagger: 0.06 })
    cards.forEach((card) => {
      const valEl = card.querySelector('.stat-value')
      const target = Number(valEl?.textContent) || 0
      if (!valEl || target === 0) return
      const proxy = { v: 0 }
      gsap.to(proxy, {
        v: target,
        duration: 0.8,
        ease: easeMap.out,
        onUpdate: () => { valEl.textContent = Math.round(proxy.v).toString() },
      })
    })
  }))
})

function formatValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? '开启' : '关闭'
  if (v === null || v === undefined) return '-'
  return String(v)
}

const categoryLabels: Record<string, string> = {
  file: '文件操作',
  code: '代码',
  web: '网络',
  system: '系统',
  interactive: '交互',
  memory: '记忆',
  skills: '技能',
}

function categoryLabel(cat: string): string {
  return categoryLabels[cat] ?? cat
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api.getCapabilities()
    settings.value = data.settings ?? {}
    tools.value = data.tools ?? []
    tool_categories.value = data.tool_categories ?? {}
    providers.value = data.providers ?? []
    mcp_servers.value = data.mcp_servers ?? []
    discovered_mcp.value = data.discovered_mcp ?? null
    env.value = data.env ?? {}
    system.value = data.system ?? {}
    memory.value = data.memory ?? null
    configSources.value = data.config_sources ?? null
    // Also load plugin count
    try {
      const pdata = await api.request<Record<string, unknown>[]>('/plugins')
      plugins.value = Array.isArray(pdata) ? pdata : []
    } catch { plugins.value = [] }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.capabilities-view {
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 16px 80px;
  overflow-y: auto;
  max-height: 100%;
}

.header { margin-bottom: 24px; }
.header h2 { font-size: var(--fs-display-lg); font-weight: 600; font-family: var(--font-display); letter-spacing: -0.01em; margin: 0; }
.header-sub { font-size: 0.82em; color: var(--text-tertiary); margin: 4px 0 0; }

.section {
  margin-bottom: 28px;
  background: var(--bg-card, var(--bg-secondary));
  border-radius: var(--radius);
  padding: 16px;
  border: 1px solid var(--border);
  overflow-x: auto;
}

.section h3 {
  font-size: 1em;
  font-weight: 600;
  margin: 0 0 12px;
  color: var(--text-primary);
}

/* Stats */
.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
  max-height: 200px;
  overflow-y: auto;
}
.stat-card {
  text-align: center;
  padding: 12px 8px;
  background: var(--bg-secondary);
  border-radius: var(--radius);
  border: 1px solid var(--border);
}
.stat-value { font-size: 1.6em; font-weight: 700; color: var(--accent); }
.stat-label { font-size: 0.75em; color: var(--text-tertiary); margin-top: 4px; }

/* Env */
.env-info { font-size: 0.8em; }
.env-row { display: flex; gap: 8px; padding: 4px 0; }
.env-key { color: var(--text-tertiary); min-width: 80px; }
.env-val { color: var(--text-secondary); word-break: break-all; font-family: var(--font-mono); }

/* Settings grid */
.setting-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
  max-height: 360px; overflow-y: auto;
}
.config-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 8px; background: var(--bg-secondary); border-radius: 4px;
  font-size: 0.8em; min-width: 0;
}
.config-key {
  color: var(--text-tertiary); font-family: var(--font-mono); font-size: 0.9em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 55%;
}
.config-val {
  color: var(--text-primary); font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%;
}

/* Tools grid */
.cat-section { margin-bottom: 12px; }
.cat-title { font-size: 0.85em; font-weight: 500; color: var(--text-secondary); margin: 8px 0 6px; }
.tool-grid { display: flex; flex-wrap: wrap; gap: 6px; max-height: 240px; overflow-y: auto; }
.tool-chip {
  display: inline-flex; align-items: center;
  padding: 4px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 12px;
  font-size: 0.78em;
  color: var(--text-secondary);
  cursor: default;
}
.tool-chip:hover { border-color: var(--accent); color: var(--text-primary); }

/* Provider */
.provider-list { display: flex; flex-direction: column; gap: 6px; max-height: 300px; overflow-y: auto; }
.provider-row {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 10px; background: var(--bg-secondary); border-radius: 6px;
  font-size: 0.83em;
}
.provider-name { font-weight: 500; color: var(--text-primary); flex: 1; }
.provider-model { font-family: var(--font-mono); font-size: 0.9em; color: var(--text-secondary); }
.provider-type { font-size: 0.85em; color: var(--text-tertiary); padding: 2px 6px; background: var(--bg-card); border-radius: 4px; }
.provider-status { font-size: 0.85em; padding: 2px 8px; border-radius: 4px; color: var(--text-tertiary); }
.provider-status.active { color: #22c55e; background: rgba(34,197,94,0.1); }

/* MCP */
.mcp-list { display: flex; flex-direction: column; gap: 6px; max-height: 300px; overflow-y: auto; }
.mcp-row {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 10px; background: var(--bg-secondary); border-radius: 6px;
  font-size: 0.83em; min-width: 0;
}
.mcp-name { font-weight: 500; color: var(--text-primary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mcp-transport { font-family: var(--font-mono); font-size: 0.9em; color: var(--text-tertiary); }
.mcp-status { font-size: 0.85em; padding: 2px 8px; border-radius: 4px; color: var(--text-tertiary); }
.mcp-status.enabled { color: #22c55e; }
.mcp-status.connected { color: #3b82f6; }

/* Config sources */
.section-desc { font-size: 0.78em; color: var(--text-tertiary); margin: -8px 0 12px; }
.source-list { display: flex; flex-direction: column; gap: 4px; max-height: 400px; overflow-y: auto; }
.source-row {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 10px; border-radius: 6px; font-size: 0.8em; min-width: 0;
}
.source-row.active { background: var(--bg-secondary); }
.source-row.inactive { opacity: 0.45; }
.source-priority { font-family: var(--font-mono); font-size: 0.85em; color: var(--text-tertiary); min-width: 24px; flex-shrink: 0; }
.source-info { flex: 1; min-width: 0; overflow: hidden; }
.source-name { font-weight: 500; color: var(--text-primary); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-desc { font-size: 0.9em; color: var(--text-tertiary); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-scope { font-size: 0.85em; padding: 2px 6px; border-radius: 4px; background: var(--bg-card); color: var(--text-tertiary); flex-shrink: 0; }
.source-status { font-size: 0.85em; padding: 2px 8px; border-radius: 4px; color: var(--text-tertiary); }
.source-status.found { color: #22c55e; background: rgba(34,197,94,0.08); }
.conflict-section { margin-top: 12px; }
.conflict-title { color: #f59e0b; }
.conflict-card { padding: 8px 10px; background: rgba(245,158,11,0.06); border: 1px solid rgba(245,158,11,0.2); border-radius: 6px; margin-bottom: 6px; }
.conflict-scope { font-size: 0.8em; font-weight: 600; color: #f59e0b; }
.conflict-sources { font-size: 0.85em; color: var(--text-secondary); margin-top: 2px; }
.conflict-note { font-size: 0.75em; color: var(--text-tertiary); margin-top: 4px; }
.conflict-clear { font-size: 0.82em; color: #22c55e; padding: 6px 0; }

.loading, .empty {
  text-align: center; padding: 40px; color: var(--text-tertiary);
}
.btn {
  padding: 6px 16px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg-secondary); cursor: pointer; font-size: 0.85em; margin-top: 8px;
}
</style>
