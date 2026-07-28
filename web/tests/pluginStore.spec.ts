import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePluginStore } from '@/stores/plugin'

// Mock api module
vi.mock('@/api', () => ({
  api: {
    listPlugins: vi.fn(),
    installPlugin: vi.fn(),
    uninstallPlugin: vi.fn(),
    togglePlugin: vi.fn(),
    getPluginDetail: vi.fn(),
  },
}))

import { api } from '@/api'

const mockApi = vi.mocked(api)

describe('usePluginStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('loadPlugins', () => {
    it('loads plugins successfully', async () => {
      const plugins = [
        { name: 'test-plugin', enabled: true, version: '1.0.0' },
        { name: 'another-plugin', enabled: false },
      ]
      mockApi.listPlugins.mockResolvedValue(plugins as any)

      const store = usePluginStore()
      await store.loadPlugins()

      expect(store.plugins).toEqual(plugins)
      expect(store.loading).toBe(false)
      expect(store.error).toBe('')
    })

    it('handles load error', async () => {
      mockApi.listPlugins.mockRejectedValue(new Error('Network error'))

      const store = usePluginStore()
      await expect(store.loadPlugins()).rejects.toThrow('Network error')

      expect(store.error).toBe('Network error')
      expect(store.loading).toBe(false)
    })
  })

  describe('installPlugin', () => {
    it('installs plugin and adds to list', async () => {
      const newPlugin = { name: 'new-plugin', enabled: true }
      mockApi.installPlugin.mockResolvedValue({ ok: true, plugin: newPlugin } as any)

      const store = usePluginStore()
      const result = await store.installPlugin({ spec: 'new-plugin' })

      expect(result.ok).toBe(true)
      expect(store.plugins).toContainEqual(newPlugin)
      expect(store.installing).toBe(false)
    })

    it('sets installProgress during installation', async () => {
      mockApi.installPlugin.mockResolvedValue({ ok: true } as any)
      mockApi.listPlugins.mockResolvedValue([])

      const store = usePluginStore()
      const promise = store.installPlugin({ spec: 'test' })

      expect(store.installing).toBe(true)
      expect(store.installProgress?.status).toBe('installing')

      await promise
      expect(store.installProgress?.status).toBe('success')
    })
  })

  describe('uninstallPlugin', () => {
    it('removes plugin from list', async () => {
      mockApi.listPlugins.mockResolvedValue([
        { name: 'a', enabled: true },
        { name: 'b', enabled: true },
      ] as any)
      mockApi.uninstallPlugin.mockResolvedValue({ ok: true })

      const store = usePluginStore()
      await store.loadPlugins()
      await store.uninstallPlugin('a')

      expect(store.plugins).toHaveLength(1)
      expect(store.plugins[0].name).toBe('b')
    })
  })

  describe('togglePlugin', () => {
    it('toggles plugin enabled state', async () => {
      mockApi.listPlugins.mockResolvedValue([{ name: 'x', enabled: true }] as any)
      mockApi.togglePlugin.mockResolvedValue({ ok: true })

      const store = usePluginStore()
      await store.loadPlugins()
      await store.togglePlugin('x', false)

      expect(store.plugins[0].enabled).toBe(false)
    })
  })

  describe('filteredPlugins', () => {
    it('filters by query', async () => {
      mockApi.listPlugins.mockResolvedValue([
        { name: 'markdown-tools', enabled: true, description: 'MD utilities' },
        { name: 'code-linter', enabled: true, description: 'Lint code' },
      ] as any)

      const store = usePluginStore()
      await store.loadPlugins()
      store.setFilter({ query: 'markdown' })

      expect(store.filteredPlugins).toHaveLength(1)
      expect(store.filteredPlugins[0].name).toBe('markdown-tools')
    })

    it('filters by enabled status', async () => {
      mockApi.listPlugins.mockResolvedValue([
        { name: 'a', enabled: true },
        { name: 'b', enabled: false },
      ] as any)

      const store = usePluginStore()
      await store.loadPlugins()
      store.setFilter({ enabled: true })

      expect(store.filteredPlugins).toHaveLength(1)
      expect(store.filteredPlugins[0].name).toBe('a')
    })

    it('clearFilter resets all filters', async () => {
      mockApi.listPlugins.mockResolvedValue([
        { name: 'a', enabled: true },
        { name: 'b', enabled: false },
      ] as any)

      const store = usePluginStore()
      await store.loadPlugins()
      store.setFilter({ query: 'nonexistent' })
      expect(store.filteredPlugins).toHaveLength(0)

      store.clearFilter()
      expect(store.filteredPlugins).toHaveLength(2)
    })
  })
})
