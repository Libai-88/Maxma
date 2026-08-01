<template>
  <div class="plugin-view" ref="rootEl">
    <div class="header">
      <h2>插件市场 PLUGIN MARKETPLACE</h2>
      <p class="header-sub">管理 OMP 插件——浏览、安装、配置与卸载</p>
    </div>

    <!-- 安装框 -->
    <div class="toolbar">
      <div class="install-box">
        <input
          v-model="installSpec"
          type="text"
          placeholder="npm 包名 / GitHub URL / git URL..."
          @keyup.enter="handleInstall"
          :disabled="store.installing"
        />
        <button
          class="btn btn-primary"
          @click="handleInstall"
          :disabled="store.installing || !installSpec.trim()"
        >
          {{ store.installing ? '安装中...' : '安装' }}
        </button>
      </div>
      <div v-if="store.installProgress" class="install-progress">
        {{ store.installProgress.status === 'success' ? '✓' : '⏳' }}
        {{ store.installProgress.spec }} -
        {{ store.installProgress.status === 'success' ? '安装成功' : '正在安装...' }}
      </div>
    </div>

    <!-- 搜索与过滤 -->
    <PluginSearchBar @search="handleSearch" />

    <!-- 错误提示 -->
    <div v-if="store.error" class="error-banner">
      {{ store.error }}
      <button class="error-close" @click="store.clearError()">✕</button>
    </div>

    <!-- 加载状态 -->
    <div v-if="store.loading" class="loading">加载中...</div>

    <!-- 插件列表 -->
    <template v-else>
      <div v-if="store.filteredPlugins.length === 0" class="empty">
        <div class="empty-icon">🧩</div>
        <div class="empty-title">{{ store.plugins.length === 0 ? '暂无已安装的插件' : '没有匹配的插件' }}</div>
        <div class="empty-desc">
          {{ store.plugins.length === 0 ? '在上方输入 npm 包名或 GitHub URL 安装插件。' : '尝试调整搜索条件或过滤器。' }}
        </div>
      </div>
      <div v-else ref="listRef" class="plugin-list">
        <PluginCard
          v-for="plugin in store.filteredPlugins"
          :key="plugin.name"
          :plugin="plugin"
          @toggle="handleToggle"
          @configure="handleConfigure"
          @uninstall="handleUninstall"
          @open="handleConfigure"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePluginStore } from '@/stores/plugin'
import { confirmAction } from '@/composables/useConfirm'
import PluginCard from '@/components/plugins/PluginCard.vue'
import PluginSearchBar from '@/components/plugins/PluginSearchBar.vue'
import type { PluginCategory } from '@/types/plugin'
import { useReveal } from '@/composables/useReveal'
import { useButtonFx } from '@/composables/useButtonFx'

const router = useRouter()
const store = usePluginStore()
const installSpec = ref('')
const listRef = ref<HTMLElement | null>(null)
const rootEl = ref<HTMLElement | null>(null)

// 安装主 CTA：磁吸 + 弹性
useButtonFx(() => rootEl.value, '.btn', { hoverScale: 1.08, bounceIcon: true, magnetic: 10 })

// 插件卡片错落入场（加载完成后）
useReveal(() => listRef.value, '.plugin-list > *', { stagger: 0.05 })

onMounted(() => {
  store.loadPlugins()
})

async function handleInstall() {
  const spec = installSpec.value.trim()
  if (!spec || store.installing) return
  try {
    await store.installPlugin({ spec })
    installSpec.value = ''
  } catch {
    // Error handled by store
  }
}

async function handleToggle(name: string) {
  const plugin = store.plugins.find(p => p.name === name)
  if (!plugin) return
  try {
    await store.togglePlugin(name, !plugin.enabled)
  } catch {
    // Error handled by store
  }
}

function handleConfigure(name: string) {
  router.push(`/plugins/${encodeURIComponent(name)}`)
}

async function handleUninstall(name: string) {
  if (!await confirmAction({
    title: '卸载插件',
    message: `确定要卸载插件 "${name}"？此操作不可撤销。`,
    confirmText: '卸载',
    danger: true,
  })) return
  try {
    await store.uninstallPlugin(name)
  } catch {
    // Error handled by store
  }
}

function handleSearch(query: string, category: PluginCategory | undefined, enabled: boolean | undefined) {
  store.setFilter({ query, category, enabled })
}
</script>

<style scoped>
.plugin-view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}

.header {
  margin-bottom: 16px;
}

.header h2 {
  font-size: var(--fs-display-lg);
  font-weight: 600;
  font-family: var(--font-display);
  letter-spacing: -0.01em;
  margin: 0;
}

.header-sub {
  font-size: 0.82em;
  color: var(--text-tertiary);
  margin: 4px 0 0;
}

.toolbar {
  margin-bottom: 16px;
}

.install-box {
  display: flex;
  gap: 8px;
}

.install-box input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.9em;
}

.install-box input:focus {
  outline: none;
  border-color: var(--accent);
}

.btn {
  padding: 8px 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  cursor: pointer;
  font-size: 0.85em;
  color: var(--text-secondary);
  white-space: nowrap;
  transition: all 0.15s;
}

.btn-primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.install-progress {
  margin-top: 8px;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border-radius: 6px;
  font-size: 0.85em;
  color: var(--text-secondary);
}

.error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border-radius: 6px;
  font-size: 0.85em;
  margin-bottom: 12px;
}

.error-close {
  padding: 2px 6px;
  border: none;
  background: transparent;
  color: #ef4444;
  cursor: pointer;
  font-size: 1.1em;
}

.loading,
.empty {
  text-align: center;
  padding: 60px 20px;
  color: var(--text-tertiary);
}

.empty-icon {
  font-size: 3em;
  margin-bottom: 12px;
}

.empty-title {
  font-size: 1.1em;
  font-weight: 600;
  margin-bottom: 6px;
}

.empty-desc {
  font-size: 0.9em;
}

.plugin-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

@media (max-width: 768px) {
  .plugin-list {
    grid-template-columns: 1fr;
  }
}
</style>
