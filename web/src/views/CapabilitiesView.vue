<template>
  <div class="capabilities-view">
    <div class="header">
      <h2>能力仪表盘 CAPABILITIES</h2>
      <p class="header-sub">OMP 自动发现与配置的全部能力模块概览</p>
    </div>

    <div v-if="loading" class="loading">加载中...</div>

    <div v-else-if="error" class="empty">
      <p>加载失败: {{ error }}</p>
      <button class="btn" @click="load">重试</button>
    </div>

    <template v-else>
      <!-- 系统概览卡片 -->
      <div class="section">
        <h3>系统概览</h3>
        <div class="stats-row">
          <div class="stat-card">
            <div class="stat-value">{{ system.session_count ?? 0 }}</div>
            <div class="stat-label">活跃会话</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{{ tools.length }}</div>
            <div class="stat-label">可用工具</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{{ providers.length }}</div>
            <div class="stat-label">模型提供商</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{{ mcp_servers.length + (discovered_mcp?.length ?? 0) }}</div>
            <div class="stat-label">MCP 服务器</div>
          </div>
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
        <div v-else class="setting-grid">
          <div v-for="(value, key) in settings" :key="key" class="config-item">
            <span class="config-key">{{ key }}</span>
            <span class="config-val">{{ formatValue(value) }}</span>
          </div>
        </div>
      </div>

      <!-- 工具类别 -->
      <div class="section" v-if="Object.keys(tool_categories).length > 0">
        <h3>工具清单 ({{ tools.length }})</h3>
        <div v-for="(catTools, cat) in tool_categories" :key="cat" class="cat-section">
          <h4 class="cat-title">{{ categoryLabel(cat) }} ({{ catTools.length }})</h4>
          <div class="tool-grid">
            <div v-for="t in catTools" :key="t.name" class="tool-chip" :title="t.description">
              <span class="tool-name">{{ t.label ?? t.name }}</span>
            </div>
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
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '@/api'
import type { CapabilitiesResponse, ToolItem, ProviderItem } from '@/types'

const loading = ref(true)
const error = ref('')
const settings = ref<Record<string, unknown>>({})
const tools = ref<ToolItem[]>([])
const tool_categories = ref<Record<string, ToolItem[]>>({})
const providers = ref<ProviderItem[]>([])
const mcp_servers = ref<any[]>([])
const discovered_mcp = ref<any[] | null>(null)
const env = ref<Record<string, string>>({})
const system = ref<Record<string, number | boolean>>({})

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
}

.header { margin-bottom: 24px; }
.header h2 { font-size: 1.3em; font-weight: 600; margin: 0; }
.header-sub { font-size: 0.82em; color: var(--text-tertiary); margin: 4px 0 0; }

.section {
  margin-bottom: 28px;
  background: var(--bg-card, var(--bg-secondary));
  border-radius: var(--radius);
  padding: 16px;
  border: 1px solid var(--border);
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
.setting-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.config-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 8px; background: var(--bg-secondary); border-radius: 4px;
  font-size: 0.8em;
}
.config-key { color: var(--text-tertiary); font-family: var(--font-mono); font-size: 0.9em; }
.config-val { color: var(--text-primary); font-weight: 500; }

/* Tools grid */
.cat-section { margin-bottom: 12px; }
.cat-title { font-size: 0.85em; font-weight: 500; color: var(--text-secondary); margin: 8px 0 6px; }
.tool-grid { display: flex; flex-wrap: wrap; gap: 6px; }
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
.provider-list { display: flex; flex-direction: column; gap: 6px; }
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
.mcp-list { display: flex; flex-direction: column; gap: 6px; }
.mcp-row {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 10px; background: var(--bg-secondary); border-radius: 6px;
  font-size: 0.83em;
}
.mcp-name { font-weight: 500; color: var(--text-primary); flex: 1; }
.mcp-transport { font-family: var(--font-mono); font-size: 0.9em; color: var(--text-tertiary); }
.mcp-status { font-size: 0.85em; padding: 2px 8px; border-radius: 4px; color: var(--text-tertiary); }
.mcp-status.enabled { color: #22c55e; }
.mcp-status.connected { color: #3b82f6; }

.loading, .empty {
  text-align: center; padding: 40px; color: var(--text-tertiary);
}
.btn {
  padding: 6px 16px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg-secondary); cursor: pointer; font-size: 0.85em; margin-top: 8px;
}
</style>
