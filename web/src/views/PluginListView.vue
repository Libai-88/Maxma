<template>
  <div class="plugin-view ds-view" ref="rootEl">
    <div class="header view-header">
      <h2>插件</h2>
      <!-- 品牌更正：OMP 是上一代引擎（已退役），本产品是 Maxma + pi 引擎。 -->
      <p class="header-sub">管理随 Maxma 分发的插件——启用、配置与卸载</p>
    </div>

    <!-- 安装框（CAP-HONESTY-001）：
         capabilities.features.plugins.marketplace 是 false（当前发布状态），
         而 POST /api/plugins/install 对任何未随包分发的 spec 一律回 501
         （bun-backend/src/routes/plugins.ts）。此前这里无条件渲染
         「npm 包名 / GitHub URL / git URL...」的输入框，等于承诺了一个
         后端明确拒绝的能力。现在按 marketplace 标志分支：
           - 开：网络安装（未来安全评审落地后）
           - 关：只说「启用随包分发的插件」，并解释为什么不能联网安装 -->
    <div class="toolbar">
      <div class="install-box">
        <label class="install-label" for="plugin-install-spec">{{ installBoxTitle }}</label>
        <div class="install-row">
          <input
            id="plugin-install-spec"
            v-model="installSpec"
            type="text"
            :placeholder="installPlaceholder"
            @keyup.enter="handleInstall"
            :disabled="store.installing"
          />
          <button
            class="btn btn-primary"
            @click="handleInstall"
            :disabled="store.installing || !installSpec.trim()"
          >
            {{ store.installing ? '处理中...' : installActionLabel }}
          </button>
        </div>
        <p class="install-note">{{ installNote }}</p>
      </div>
      <div v-if="store.installProgress" class="install-progress">
        {{ store.installProgress.status === 'success' ? '✓' : store.installProgress.status === 'error' ? '✗' : '⏳' }}
        {{ store.installProgress.spec }} -
        {{ store.installProgress.status === 'success' ? '已启用' : store.installProgress.status === 'error' ? '启用失败' : '正在处理...' }}
      </div>
    </div>

    <!-- 搜索与过滤 -->
    <PluginSearchBar @search="handleSearch" />

    <!-- 错误提示 -->
    <div v-if="store.error" class="error-banner ds-inline-error">
      {{ store.error }}
      <button class="error-close" @click="store.clearError()">✕</button>
    </div>

    <!-- 加载状态 -->
    <div v-if="store.loading" class="loading ds-state">加载中...</div>

    <!-- 插件列表 -->
    <template v-else>
      <div v-if="store.filteredPlugins.length === 0" class="empty ds-state">
        <div class="empty-icon ds-state__icon"><Icon name="puzzle" :size="24" /></div>
        <div class="empty-title ds-state__title">{{ store.plugins.length === 0 ? '没有可启用的插件' : '没有匹配的插件' }}</div>
        <div class="empty-desc ds-state__desc">
          {{ store.plugins.length === 0 ? emptyListDesc : '尝试调整搜索条件或过滤器。' }}
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
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePluginStore } from '@/stores/plugin'
import Icon from '@/components/Icon.vue'
import { confirmAction } from '@/composables/useConfirm'
import PluginCard from '@/components/plugins/PluginCard.vue'
import PluginSearchBar from '@/components/plugins/PluginSearchBar.vue'
import type { PluginCategory } from '@/types/plugin'
import { useReveal } from '@/composables/useReveal'
import { useButtonFx } from '@/composables/useButtonFx'
import { useCapabilitiesStore } from '@/stores/capabilities'

const router = useRouter()
const store = usePluginStore()
const installSpec = ref('')
const listRef = ref<HTMLElement | null>(null)
const rootEl = ref<HTMLElement | null>(null)

const capabilitiesStore = useCapabilitiesStore()

// 后端 plugins.marketplace 决定这个框到底能做什么（缺失时按 false 处理：
// 宁可少承诺，也不重复「装了但 501」的旧行为）。
const marketplaceEnabled = computed(
  () => capabilitiesStore.getFeatureConfig('plugins').marketplace === true,
)

const installBoxTitle = computed(() =>
  marketplaceEnabled.value ? '安装插件' : '启用随包分发的插件',
)

const installPlaceholder = computed(() =>
  marketplaceEnabled.value
    ? 'npm 包名 / GitHub URL / git URL...'
    : '插件标识，例如 codearts-auth',
)

const installActionLabel = computed(() => (marketplaceEnabled.value ? '安装' : '启用'))

const installNote = computed(() =>
  marketplaceEnabled.value
    ? '安装来源需先通过安全评审（下载校验、体积与条目上限、路径穿越防护）。'
    : '当前仅支持启用随 Maxma 分发的插件；从网络安装第三方插件需要先通过安全评审，'
      + '该能力位（plugins.marketplace）开启后此输入框才会接受 npm / GitHub 来源。',
)

const emptyListDesc = computed(() =>
  marketplaceEnabled.value
    ? '在上方输入 npm 包名或 GitHub URL 安装插件。'
    : '在上方输入插件标识（如 codearts-auth）即可启用随包分发的插件。',
)

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
}

.toolbar {
  margin-bottom: 16px;
}

.install-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.install-label {
  font-size: 0.82em;
  font-weight: 600;
  color: var(--text-secondary);
}

.install-row {
  display: flex;
  gap: 8px;
}

.install-note {
  margin: 0;
  font-size: 0.75em;
  line-height: 1.5;
  color: var(--text-tertiary);
}

.install-box input {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-input);
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
  border-radius: var(--radius-input);
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
  border-radius: var(--radius-input);
  font-size: 0.85em;
  color: var(--text-secondary);
}

.error-close {
  padding: 2px 6px;
  border: none;
  background: transparent;
  color: var(--status-error-text);
  cursor: pointer;
  font-size: 1.1em;
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
