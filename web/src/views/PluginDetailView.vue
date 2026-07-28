<template>
  <div class="plugin-detail-view">
    <div class="header">
      <button class="back-btn" @click="router.push('/plugins')">← 返回插件市场</button>
      <h2>{{ pluginName }}</h2>
      <p class="header-sub">插件详情与配置</p>
    </div>

    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="error" class="error-banner">{{ error }}</div>
    <template v-else-if="detail">
      <!-- 基本信息 -->
      <div class="section">
        <div class="info-grid">
          <div v-if="detail.version" class="info-item">
            <span class="info-label">版本</span>
            <span class="info-value">{{ detail.version }}</span>
          </div>
          <div v-if="detail.author" class="info-item">
            <span class="info-label">作者</span>
            <span class="info-value">{{ detail.author }}</span>
          </div>
          <div v-if="detail.license" class="info-item">
            <span class="info-label">许可证</span>
            <span class="info-value">{{ detail.license }}</span>
          </div>
          <div v-if="detail.homepage" class="info-item">
            <span class="info-label">主页</span>
            <a :href="detail.homepage" target="_blank" class="info-link">{{ detail.homepage }}</a>
          </div>
          <div v-if="detail.repository" class="info-item">
            <span class="info-label">仓库</span>
            <a :href="detail.repository" target="_blank" class="info-link">{{ detail.repository }}</a>
          </div>
          <div v-if="detail.installed_at" class="info-item">
            <span class="info-label">安装时间</span>
            <span class="info-value">{{ formatDate(detail.installed_at) }}</span>
          </div>
        </div>
      </div>

      <!-- 描述 -->
      <div v-if="detail.description" class="section">
        <h3>描述</h3>
        <p class="desc-text">{{ detail.description }}</p>
      </div>

      <!-- 功能特性 -->
      <div v-if="detail.features && detail.features.length" class="section">
        <h3>功能特性</h3>
        <div class="feature-list">
          <span v-for="f in detail.features" :key="f" class="feature-tag">{{ f }}</span>
        </div>
      </div>

      <!-- 依赖 -->
      <div v-if="detail.dependencies && Object.keys(detail.dependencies).length" class="section">
        <h3>依赖</h3>
        <div class="dep-list">
          <div v-for="(ver, dep) in detail.dependencies" :key="dep" class="dep-item">
            <span class="dep-name">{{ dep }}</span>
            <span class="dep-ver">{{ ver }}</span>
          </div>
        </div>
      </div>

      <!-- README -->
      <div v-if="detail.readme" class="section">
        <h3>README</h3>
        <div class="readme-content" v-html="renderedReadme"></div>
      </div>

      <!-- 配置 -->
      <div v-if="detail.config_schema" class="section">
        <h3>配置</h3>
        <PluginConfigPanel
          :schema="detail.config_schema"
          :config="pluginConfig"
          @update="handleConfigUpdate"
        />
      </div>
      <div v-else class="section">
        <h3>配置</h3>
        <p class="no-config">此插件没有可配置的选项。</p>
      </div>

      <!-- 操作 -->
      <div class="section actions-section">
        <button
          class="btn"
          :class="detail.enabled ? 'btn-warning' : 'btn-primary'"
          @click="handleToggle"
        >
          {{ detail.enabled ? '禁用插件' : '启用插件' }}
        </button>
        <button class="btn btn-danger" @click="handleUninstall">卸载插件</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePluginStore } from '@/stores/plugin'
import { confirmAction } from '@/composables/useConfirm'
import { api } from '@/api'
import PluginConfigPanel from '@/components/plugins/PluginConfigPanel.vue'
import type { PluginDetail } from '@/types/plugin'

const route = useRoute()
const router = useRouter()
const store = usePluginStore()

const pluginName = computed(() => route.params.name as string)
const detail = ref<PluginDetail | null>(null)
const pluginConfig = ref<Record<string, unknown>>({})
const loading = ref(true)
const error = ref('')

const renderedReadme = computed(() => {
  if (!detail.value?.readme) return ''
  // 简单的 markdown 转义渲染（生产环境应使用 marked 库）
  return detail.value.readme
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
})

onMounted(async () => {
  await loadDetail()
})

async function loadDetail() {
  loading.value = true
  error.value = ''
  try {
    detail.value = await store.getPluginDetail(pluginName.value)
    // 加载配置
    try {
      const configRes = await api.getPluginConfig(pluginName.value)
      pluginConfig.value = configRes.config || {}
    } catch {
      // 配置加载失败不阻塞详情页
      pluginConfig.value = {}
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function handleToggle() {
  if (!detail.value) return
  try {
    await store.togglePlugin(pluginName.value, !detail.value.enabled)
    detail.value.enabled = !detail.value.enabled
  } catch {
    // Error handled by store
  }
}

async function handleUninstall() {
  if (!await confirmAction({
    title: '卸载插件',
    message: `确定要卸载插件 "${pluginName.value}"？此操作不可撤销。`,
    confirmText: '卸载',
    danger: true,
  })) return
  try {
    await store.uninstallPlugin(pluginName.value)
    router.push('/plugins')
  } catch {
    // Error handled by store
  }
}

async function handleConfigUpdate(config: Record<string, unknown>) {
  try {
    await api.updatePluginConfig(pluginName.value, config)
    pluginConfig.value = config
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString('zh-CN')
  } catch {
    return dateStr
  }
}
</script>

<style scoped>
.plugin-detail-view {
  max-width: 800px;
  margin: 0 auto;
  padding: 24px 16px 80px;
}

.header {
  margin-bottom: 24px;
}

.back-btn {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.85em;
  margin-bottom: 12px;
  transition: all 0.15s;
}

.back-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
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

.loading,
.error-banner {
  padding: 20px;
  text-align: center;
  color: var(--text-tertiary);
}

.error-banner {
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
  border-radius: 6px;
}

.section {
  margin-bottom: 28px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border);
}

.section:last-child {
  border-bottom: none;
}

.section h3 {
  font-size: 1em;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.info-label {
  font-size: 0.75em;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.info-value {
  font-size: 0.9em;
  color: var(--text-primary);
}

.info-link {
  font-size: 0.9em;
  color: var(--accent);
  text-decoration: none;
}

.info-link:hover {
  text-decoration: underline;
}

.desc-text {
  font-size: 0.9em;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0;
}

.feature-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.feature-tag {
  font-size: 0.8em;
  padding: 4px 10px;
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
}

.dep-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dep-item {
  display: flex;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--bg-secondary);
  border-radius: 4px;
  font-size: 0.85em;
}

.dep-name {
  color: var(--text-primary);
  font-family: var(--font-mono);
}

.dep-ver {
  color: var(--text-tertiary);
  font-family: var(--font-mono);
}

.readme-content {
  font-size: 0.9em;
  color: var(--text-secondary);
  line-height: 1.6;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 6px;
}

.no-config {
  font-size: 0.9em;
  color: var(--text-tertiary);
  margin: 0;
}

.actions-section {
  display: flex;
  gap: 12px;
}

.btn {
  padding: 10px 20px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  cursor: pointer;
  font-size: 0.9em;
  color: var(--text-secondary);
  transition: all 0.15s;
}

.btn-primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}

.btn-warning {
  background: #f59e0b;
  color: white;
  border-color: #f59e0b;
}

.btn-danger {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border-color: #ef4444;
}

.btn-danger:hover {
  background: #ef4444;
  color: white;
}
</style>
