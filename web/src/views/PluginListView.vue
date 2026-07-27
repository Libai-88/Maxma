<template>
  <div class="plugin-view">
    <div class="header">
      <h2>插件管理器 PLUGINS</h2>
      <p class="header-sub">管理 OMP 插件——安装、卸载、启用/禁用扩展能力</p>
    </div>

    <div class="toolbar">
      <div class="install-box">
        <input v-model="installSpec" type="text" placeholder="npm 包名 / GitHub URL / git URL..."
          @keyup.enter="handleInstall" :disabled="installing" />
        <button class="btn btn-primary" @click="handleInstall" :disabled="installing || !installSpec.trim()">
          {{ installing ? '安装中...' : '安装' }}
        </button>
      </div>
    </div>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <div v-if="loading" class="loading">加载中...</div>
    <template v-else>
      <div v-if="plugins.length === 0" class="empty">
        <div class="empty-icon">🧩</div>
        <div class="empty-title">暂无已安装的插件</div>
        <div class="empty-desc">
          在上方输入 npm 包名或 GitHub URL 安装插件。
        </div>
      </div>
      <div v-else class="plugin-list">
        <div v-for="p in plugins" :key="p.name" class="plugin-card">
          <div class="plugin-header">
            <span class="plugin-name">{{ p.name }}</span>
            <span v-if="p.version" class="plugin-version">v{{ p.version }}</span>
            <button class="toggle-btn" :class="{ on: p.enabled }" @click="togglePlugin(p)">
              {{ p.enabled ? '启用' : '禁用' }}
            </button>
            <button class="btn-danger" @click="uninstall(p)" title="卸载">✕</button>
          </div>
          <div v-if="p.description" class="plugin-desc">{{ p.description }}</div>
          <div v-if="p.features && p.features.length" class="plugin-features">
            <span v-for="f in p.features" :key="f" class="feature-tag">{{ f }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '@/api'

interface Plugin {
  name: string
  version?: string
  description?: string
  enabled: boolean
  features?: string[]
  homepage?: string
}

const plugins = ref<Plugin[]>([])
const loading = ref(true)
const error = ref('')
const installSpec = ref('')
const installing = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api.request<Plugin[]>('/plugins')
    plugins.value = Array.isArray(data) ? data : []
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function handleInstall() {
  const spec = installSpec.value.trim()
  if (!spec || installing.value) return
  installing.value = true
  error.value = ''
  try {
    const result = await api.request<{ ok: boolean }>('/plugins/install', {
      method: 'POST',
      body: JSON.stringify({ spec }),
    })
    if (result.ok) {
      installSpec.value = ''
      await load()
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    installing.value = false
  }
}

async function togglePlugin(p: Plugin) {
  try {
    await api.request(`/plugins/${encodeURIComponent(p.name)}/toggle`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: !p.enabled }),
    })
    p.enabled = !p.enabled
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function uninstall(p: Plugin) {
  if (!confirm(`确定卸载插件 "${p.name}"？`)) return
  try {
    await api.request(`/plugins/${encodeURIComponent(p.name)}`, { method: 'DELETE' })
    plugins.value = plugins.value.filter(x => x.name !== p.name)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

onMounted(load)
</script>

<style scoped>
.plugin-view { max-width: 720px; margin: 0 auto; padding: 24px 16px 80px; }
.header { margin-bottom: 16px; }
.header h2 { font-size: 1.3em; font-weight: 600; margin: 0; }
.header-sub { font-size: 0.82em; color: var(--text-tertiary); margin: 4px 0 0; }

.toolbar { margin-bottom: 16px; }
.install-box { display: flex; gap: 8px; }
.install-box input {
  flex: 1; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg-secondary); color: var(--text-primary); font-size: 0.85em;
}
.btn {
  padding: 6px 14px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg-secondary); cursor: pointer; font-size: 0.8em; color: var(--text-secondary);
  white-space: nowrap;
}
.btn-primary { background: var(--accent); color: white; border-color: var(--accent); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.error-banner {
  padding: 8px 12px; background: rgba(239,68,68,0.08); color: #ef4444;
  border-radius: 6px; font-size: 0.85em; margin-bottom: 12px;
}

.loading, .empty { text-align: center; padding: 40px; color: var(--text-tertiary); }
.empty-icon { font-size: 2em; margin-bottom: 8px; }
.empty-title { font-size: 1em; font-weight: 600; margin-bottom: 4px; }
.empty-desc { font-size: 0.85em; }

.plugin-list { display: flex; flex-direction: column; gap: 8px; max-height: 600px; overflow-y: auto; }
.plugin-card {
  padding: 12px 14px; background: var(--bg-card); border: 1px solid var(--border); min-width: 0;
  overflow: hidden;
  border-radius: var(--radius);
}
.plugin-card:hover { border-color: var(--accent-soft); }
.plugin-header { display: flex; align-items: center; gap: 10px; }
.plugin-name { font-weight: 600; font-size: 0.9em; color: var(--text-primary); flex: 1; }
.plugin-version { font-size: 0.75em; color: var(--text-tertiary); font-family: var(--font-mono); }
.plugin-desc { font-size: 0.82em; color: var(--text-secondary); margin-top: 6px; line-height: 1.5; }
.plugin-features { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.feature-tag {
  font-size: 0.7em; padding: 2px 8px; border-radius: 4px;
  background: var(--bg-secondary); color: var(--text-tertiary);
}
.toggle-btn {
  padding: 3px 10px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg-secondary); color: var(--text-secondary); cursor: pointer;
  font-size: 0.75em; transition: all 0.15s;
}
.toggle-btn.on { background: var(--accent); color: white; border-color: var(--accent); }
.btn-danger {
  background: none; border: none; cursor: pointer; font-size: 0.9em;
  color: var(--text-tertiary); padding: 4px 6px; border-radius: 4px;
}
.btn-danger:hover { color: #ef4444; background: rgba(239,68,68,0.08); }
</style>
