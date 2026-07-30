<template>
  <div class="ext-view">
    <div class="header">
      <h2>扩展管理器 EXTENSIONS</h2>
      <p class="header-sub">OMP 工具、MCP 服务器与扩展模块</p>
    </div>

    <div v-if="loading" class="loading">扫描中...</div>
    <div v-else-if="error" class="empty">
      <p>加载失败: {{ error }}</p>
      <button class="btn" @click="load">重试</button>
    </div>
    <template v-else>
      <!-- 系统状态 -->
      <div class="section status-section">
        <div class="status-grid">
          <div class="status-item">
            <span class="status-dot" :class="systemStatus.sidecar_available ? 'online' : 'offline'"></span>
            <span>Sidecar {{ systemStatus.sidecar_available ? '运行中' : '离线' }}</span>
          </div>
          <div class="status-item">
            <span class="status-value">{{ tools.length }}</span>
            <span class="status-label">工具</span>
          </div>
          <div class="status-item">
            <span class="status-value">{{ mcpServers.length }}</span>
            <span class="status-label">MCP 服务器</span>
          </div>
          <div class="status-item">
            <span class="status-value">{{ customTools.length }}</span>
            <span class="status-label">自定义工具</span>
          </div>
        </div>
      </div>

      <!-- 自定义工具 / 扩展 -->
      <div class="section" v-if="customTools.length">
        <h3>自定义工具 ({{ customTools.length }})</h3>
        <div class="ext-list">
          <div v-for="t in customTools" :key="t.name" class="ext-card">
            <div class="ext-header">
              <span class="ext-name">{{ t.label || t.name }}</span>
              <span class="ext-source">{{ t.category }}</span>
            </div>
            <div v-if="t.description" class="ext-desc">{{ t.description }}</div>
          </div>
        </div>
      </div>

      <!-- 内置工具 -->
      <div class="section" v-if="builtinTools.length">
        <h3>内置工具 ({{ builtinTools.length }})</h3>
        <div class="tool-grid">
          <div v-for="t in builtinTools" :key="t.name" class="tool-chip" :title="t.description">
            {{ t.label || t.name }}
          </div>
        </div>
      </div>

      <!-- MCP 服务器 -->
      <div class="section" v-if="mcpServers.length">
        <h3>MCP 服务器 ({{ mcpServers.length }})</h3>
        <div class="ext-list">
          <div v-for="s in mcpServers" :key="s.id || s.name" class="ext-card">
            <div class="ext-header">
              <span class="ext-name">{{ s.name || s.id }}</span>
              <span class="ext-source" :class="s.status === 'running' ? 'source-ok' : 'source-warn'">
                {{ s.status || 'unknown' }}
              </span>
            </div>
            <div v-if="s.tool_count" class="ext-desc">{{ s.tool_count }} 个工具</div>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-if="!customTools.length && !mcpServers.length" class="empty">
        <div class="empty-icon">🧩</div>
        <div class="empty-title">暂未发现扩展</div>
        <div class="empty-desc">
          安装插件或配置 MCP 服务器后，扩展会自动出现在这里。
        </div>
      </div>

      <!-- 入口 -->
      <div class="section quick-links">
        <h3>相关操作</h3>
        <router-link to="/plugins" class="quick-link">→ 管理已安装的插件</router-link>
        <router-link to="/mcp" class="quick-link">→ 配置 MCP 服务器</router-link>
        <router-link to="/capabilities" class="quick-link">→ 查看能力仪表盘</router-link>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'

interface ToolInfo {
  name: string
  label?: string
  description?: string
  category?: string
  builtin?: boolean
}

interface McpServerInfo {
  id?: string
  name?: string
  status?: string
  tool_count?: number
}

interface CapabilitiesData {
  tools?: ToolInfo[]
  mcp_servers?: McpServerInfo[]
  system?: { sidecar_available?: boolean; session_count?: number }
}

const loading = ref(true)
const error = ref('')
const tools = ref<ToolInfo[]>([])
const mcpServers = ref<McpServerInfo[]>([])
const systemStatus = ref<{ sidecar_available: boolean }>({ sidecar_available: false })

// builtin !== false: includes builtin:true AND absent/undefined (which defaults to builtin)
const builtinTools = computed(() => tools.value.filter(t => t.builtin !== false))
// only tools with explicit builtin:false are custom
const customTools = computed(() => tools.value.filter(t => t.builtin === false))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const caps = await api.request<CapabilitiesData>('/capabilities')
    tools.value = caps.tools || []
    mcpServers.value = caps.mcp_servers || []
    systemStatus.value = { sidecar_available: caps.system?.sidecar_available ?? false }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.ext-view { max-width: 800px; margin: 0 auto; padding: 24px 16px 80px; }
.header { margin-bottom: 16px; }
.header h2 { font-size: var(--fs-display-lg); font-weight: 600; font-family: var(--font-display); letter-spacing: -0.01em; margin: 0; }
.header-sub { font-size: 0.82em; color: var(--text-tertiary); margin: 4px 0 0; }
.loading, .empty { text-align: center; padding: 40px; color: var(--text-tertiary); }
.empty-icon { font-size: 2em; margin-bottom: 8px; }
.empty-title { font-size: 1em; font-weight: 600; margin-bottom: 4px; }
.empty-desc { font-size: 0.85em; line-height: 1.6; }

.section {
  margin-bottom: 20px; background: var(--bg-card); border-radius: var(--radius);
  padding: 16px; border: 1px solid var(--border);
}
.section h3 { font-size: 1em; font-weight: 600; margin: 0 0 12px; color: var(--text-primary); }

.status-section { padding: 14px 16px; }
.status-grid { display: flex; gap: 24px; flex-wrap: wrap; }
.status-item { display: flex; align-items: center; gap: 6px; font-size: 0.85em; color: var(--text-secondary); }
.status-dot { width: 8px; height: 8px; border-radius: 50%; }
.status-dot.online { background: #10b981; }
.status-dot.offline { background: #ef4444; }
.status-value { font-weight: 700; font-size: 1.1em; color: var(--text-primary); }
.status-label { font-size: 0.85em; color: var(--text-tertiary); }

.ext-list { display: flex; flex-direction: column; gap: 6px; }
.ext-card { padding: 10px 12px; background: var(--bg-secondary); border-radius: 6px; }
.ext-header { display: flex; align-items: center; gap: 8px; }
.ext-name { font-weight: 600; font-size: 0.9em; color: var(--text-primary); }
.ext-source { font-size: 0.75em; padding: 2px 6px; border-radius: 4px; background: var(--bg-card); color: var(--text-tertiary); }
.source-ok { color: #10b981; }
.source-warn { color: #f59e0b; }
.ext-desc { font-size: 0.82em; color: var(--text-secondary); margin-top: 4px; line-height: 1.5; }

.tool-grid { display: flex; flex-wrap: wrap; gap: 6px; }
.tool-chip {
  font-size: 0.78em; padding: 4px 10px; border-radius: 4px;
  background: var(--bg-secondary); color: var(--text-secondary);
  cursor: default;
}

.quick-links { display: flex; flex-direction: column; gap: 8px; }
.quick-link { font-size: 0.85em; color: var(--accent); text-decoration: none; }
.quick-link:hover { text-decoration: underline; }
.btn { padding: 6px 16px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-secondary); cursor: pointer; font-size: 0.85em; margin-top: 8px; }
</style>
