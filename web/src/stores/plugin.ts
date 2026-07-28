import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/api'
import type { Plugin, PluginDetail, PluginFilter, InstallPluginRequest } from '@/types/plugin'

export const usePluginStore = defineStore('plugin', () => {
  // ── State ──
  const plugins = ref<Plugin[]>([])
  const loading = ref(false)
  const error = ref('')
  const filter = ref<PluginFilter>({})
  const installing = ref(false)
  const installProgress = ref<{ spec: string; status: string } | null>(null)

  // ── Computed ──
  const filteredPlugins = computed(() => {
    let result = plugins.value

    if (filter.value.query) {
      const q = filter.value.query.toLowerCase()
      result = result.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.tags?.some(t => t.toLowerCase().includes(q))
      )
    }

    if (filter.value.category) {
      result = result.filter(p => p.category === filter.value.category)
    }

    if (filter.value.enabled !== undefined) {
      result = result.filter(p => p.enabled === filter.value.enabled)
    }

    if (filter.value.tags && filter.value.tags.length > 0) {
      result = result.filter(p =>
        filter.value.tags!.some(tag => p.tags?.includes(tag))
      )
    }

    return result
  })

  const enabledPlugins = computed(() => plugins.value.filter(p => p.enabled))
  const disabledPlugins = computed(() => plugins.value.filter(p => !p.enabled))

  // ── Actions ──
  async function loadPlugins() {
    loading.value = true
    error.value = ''
    try {
      plugins.value = await api.listPlugins()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function installPlugin(request: InstallPluginRequest) {
    installing.value = true
    installProgress.value = { spec: request.spec, status: 'installing' }
    error.value = ''
    try {
      const result = await api.installPlugin(request)
      if (result.ok && result.plugin) {
        plugins.value.push(result.plugin)
      } else if (result.ok) {
        // 安装成功但响应中没有 plugin 对象，重新加载列表
        await loadPlugins()
      }
      installProgress.value = { spec: request.spec, status: 'success' }
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      installProgress.value = { spec: request.spec, status: 'error' }
      throw e
    } finally {
      installing.value = false
      setTimeout(() => { installProgress.value = null }, 3000)
    }
  }

  async function uninstallPlugin(name: string) {
    try {
      await api.uninstallPlugin(name)
      plugins.value = plugins.value.filter(p => p.name !== name)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    }
  }

  async function togglePlugin(name: string, enabled: boolean) {
    try {
      await api.togglePlugin(name, enabled)
      const plugin = plugins.value.find(p => p.name === name)
      if (plugin) {
        plugin.enabled = enabled
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    }
  }

  async function getPluginDetail(name: string): Promise<PluginDetail> {
    try {
      return await api.getPluginDetail(name)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    }
  }

  function setFilter(newFilter: Partial<PluginFilter>) {
    filter.value = { ...filter.value, ...newFilter }
  }

  function clearFilter() {
    filter.value = {}
  }

  function clearError() {
    error.value = ''
  }

  return {
    // state
    plugins,
    loading,
    error,
    filter,
    installing,
    installProgress,
    // computed
    filteredPlugins,
    enabledPlugins,
    disabledPlugins,
    // actions
    loadPlugins,
    installPlugin,
    uninstallPlugin,
    togglePlugin,
    getPluginDetail,
    setFilter,
    clearFilter,
    clearError,
  }
})
