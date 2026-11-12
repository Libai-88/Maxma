import { create } from 'zustand'
import { api } from '@/api'
import { toErrorMessage } from '@/utils/error'
import type {
  Plugin,
  PluginDetail,
  PluginFilter,
  InstallPluginRequest,
  InstallPluginResponse,
} from '@/types/plugin'

interface PluginDerived {
  filteredPlugins: Plugin[]
  enabledPlugins: Plugin[]
  disabledPlugins: Plugin[]
}

export interface PluginState extends PluginDerived {
  plugins: Plugin[]
  loading: boolean
  error: string
  filter: PluginFilter
  installing: boolean
  installProgress: { spec: string; status: string } | null
  loadPlugins: () => Promise<void>
  installPlugin: (request: InstallPluginRequest) => Promise<InstallPluginResponse>
  uninstallPlugin: (name: string) => Promise<void>
  togglePlugin: (name: string, enabled: boolean) => Promise<void>
  getPluginDetail: (name: string) => Promise<PluginDetail>
  setFilter: (newFilter: Partial<PluginFilter>) => void
  clearFilter: () => void
  clearError: () => void
}

function derive(plugins: Plugin[], filter: PluginFilter): PluginDerived {
  let result = plugins

  if (filter.query) {
    const q = filter.query.toLowerCase()
    result = result.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description?.toLowerCase().includes(q) ||
      p.tags?.some(t => t.toLowerCase().includes(q)),
    )
  }

  if (filter.category) {
    result = result.filter(p => p.category === filter.category)
  }

  if (filter.enabled !== undefined) {
    result = result.filter(p => p.enabled === filter.enabled)
  }

  if (filter.tags && filter.tags.length > 0) {
    result = result.filter(p => filter.tags!.some(tag => p.tags?.includes(tag)))
  }

  return {
    filteredPlugins: result,
    enabledPlugins: plugins.filter(p => p.enabled),
    disabledPlugins: plugins.filter(p => !p.enabled),
  }
}

export const usePluginStore = create<PluginState>()((set, get) => {
  function patch(p: Partial<PluginState>) {
    set((s) => {
      const plugins = p.plugins ?? s.plugins
      const filter = p.filter ?? s.filter
      return { ...p, ...derive(plugins, filter) }
    })
  }

  async function loadPlugins() {
    patch({ loading: true, error: '' })
    try {
      const data = await api.listPlugins()
      patch({ plugins: data })
    } catch (e) {
      patch({ error: toErrorMessage(e) })
      throw e
    } finally {
      patch({ loading: false })
    }
  }

  async function installPlugin(request: InstallPluginRequest): Promise<InstallPluginResponse> {
    patch({
      installing: true,
      installProgress: { spec: request.spec, status: 'installing' },
      error: '',
    })
    try {
      const result = await api.installPlugin(request)
      if (result.ok && result.plugin) {
        patch({ plugins: [...get().plugins, result.plugin] })
      } else if (result.ok) {
        // 安装成功但响应中没有 plugin 对象，重新加载列表
        await loadPlugins()
      }
      patch({ installProgress: { spec: request.spec, status: 'success' } })
      return result
    } catch (e) {
      patch({ error: toErrorMessage(e), installProgress: { spec: request.spec, status: 'error' } })
      throw e
    } finally {
      patch({ installing: false })
      setTimeout(() => patch({ installProgress: null }), 3000)
    }
  }

  async function uninstallPlugin(name: string) {
    try {
      await api.uninstallPlugin(name)
      patch({ plugins: get().plugins.filter(p => p.name !== name) })
    } catch (e) {
      patch({ error: toErrorMessage(e) })
      throw e
    }
  }

  async function togglePlugin(name: string, enabled: boolean) {
    try {
      await api.togglePlugin(name, enabled)
      patch({
        plugins: get().plugins.map(p => p.name === name ? { ...p, enabled } : p),
      })
    } catch (e) {
      patch({ error: toErrorMessage(e) })
      throw e
    }
  }

  async function getPluginDetail(name: string): Promise<PluginDetail> {
    try {
      return await api.getPluginDetail(name)
    } catch (e) {
      patch({ error: toErrorMessage(e) })
      throw e
    }
  }

  function setFilter(newFilter: Partial<PluginFilter>) {
    patch({ filter: { ...get().filter, ...newFilter } })
  }

  function clearFilter() {
    patch({ filter: {} })
  }

  function clearError() {
    patch({ error: '' })
  }

  return {
    // state
    plugins: [],
    loading: false,
    error: '',
    filter: {},
    installing: false,
    installProgress: null,
    // computed（以值形式暴露）
    ...derive([], {}),
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
